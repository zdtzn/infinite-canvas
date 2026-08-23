import vm from "node:vm";

import { assertResolvedPublicUpstreamUrl, resolveAllowedRedirect } from "./url-policy";

export type ServerPromptSourceItem = {
  id: string;
  title: string;
  coverUrl: string;
  prompt: string;
  tags: string[];
  preview: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_ITEMS = 2_000;
const SOURCE_TIMEOUT_MS = 12_000;
const SCRIPT_TIMEOUT_MS = 15_000;

export async function runPromptSourceScript(script: string, signal?: AbortSignal) {
  const body = String(script || "").trim();
  if (!body) throw new Error("提示词来源脚本为空");

  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(new DOMException("提示词来源执行超时", "TimeoutError")), SCRIPT_TIMEOUT_MS);
  try {
    const context = vm.createContext(
      {
        fetchText: (url: string) => fetchPromptSourceText(url, combinedSignal),
        fetchJson: (url: string) => fetchPromptSourceJson(url, combinedSignal),
        splitSections,
        firstMatch,
        extractImages,
        absoluteUrl,
        tagsFromHeading,
        splitTags,
        markdownPreview,
        leftPad,
        makePrompt,
        signal: combinedSignal,
      },
      { codeGeneration: { strings: false, wasm: false } },
    );
    const source = `"use strict"; (async () => {\n${body}\n})()`;
    const result = await Promise.race([
      Promise.resolve(
        new vm.Script(source, { filename: "prompt-source" }).runInContext(context, {
          timeout: SCRIPT_TIMEOUT_MS,
          displayErrors: true,
        }),
      ),
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(combinedSignal.reason || new DOMException("提示词来源执行超时", "TimeoutError"));
        if (combinedSignal.aborted) onAbort();
        else combinedSignal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    if (!Array.isArray(result)) throw new Error("提示词来源脚本需要 return 一个数组");
    return normalizePromptItems(result);
  } catch (error) {
    if (combinedSignal.aborted) throw combinedSignal.reason || new DOMException("提示词来源执行超时", "TimeoutError");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`提示词来源脚本执行失败：${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPromptSourceText(value: string, signal: AbortSignal) {
  const response = await fetchPromptSource(value, signal);
  return new TextDecoder().decode(await readResponseBytes(response, signal));
}

async function fetchPromptSourceJson(value: string, signal: AbortSignal) {
  const text = await fetchPromptSourceText(value, signal);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("提示词来源没有返回有效 JSON");
  }
}

async function fetchPromptSource(value: string, signal: AbortSignal) {
  let current = await assertResolvedPublicUpstreamUrl(value);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
    const response = await fetch(current, {
      headers: { Accept: "text/plain, application/json, text/markdown", "User-Agent": "InfiniteCanvas/1.0" },
      redirect: "manual",
      signal: AbortSignal.any([signal, timeout]),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw new Error(`提示词来源请求失败：${response.status}`);
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("提示词来源重定向地址缺失");
    current = await assertResolvedPublicUpstreamUrl(resolveAllowedRedirect(current, location));
  }
  throw new Error("提示词来源重定向次数过多");
}

async function readResponseBytes(response: Response, signal: AbortSignal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_SOURCE_BYTES) throw new Error("提示词来源响应过大");
      chunks.push(next.value);
      if (signal.aborted) throw signal.reason || new DOMException("提示词来源请求已取消", "AbortError");
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function normalizePromptItems(value: unknown[]) {
  const seen = new Set<string>();
  const items: ServerPromptSourceItem[] = [];
  for (const raw of value.slice(0, MAX_SOURCE_ITEMS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const title = String(record.title || "").trim().slice(0, 400);
    const prompt = String(record.prompt || "").trim().slice(0, 20_000);
    if (!title || !prompt) continue;
    const id = String(record.id || `prompt-${items.length + 1}`).trim().slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title,
      prompt,
      coverUrl: safeUrl(record.coverUrl),
      tags: Array.from(new Set((Array.isArray(record.tags) ? record.tags : []).map((tag) => String(tag || "").trim().slice(0, 80)).filter(Boolean))).slice(0, 40),
      preview: String(record.preview || "").slice(0, 80_000),
      createdAt: String(record.createdAt || "").slice(0, 80),
      updatedAt: String(record.updatedAt || "").slice(0, 80),
    });
  }
  return items;
}

function makePrompt(input: Partial<ServerPromptSourceItem> & Pick<ServerPromptSourceItem, "id" | "title" | "prompt">): ServerPromptSourceItem {
  return {
    id: String(input.id),
    title: String(input.title),
    prompt: String(input.prompt),
    coverUrl: String(input.coverUrl || ""),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    preview: String(input.preview || ""),
    createdAt: String(input.createdAt || ""),
    updatedAt: String(input.updatedAt || ""),
  };
}

function splitSections(text: string, prefix: string) {
  return String(text || "").split(`\n${prefix}`).map((section, index) => (index ? `${prefix}${section}` : section)).filter(Boolean);
}

function firstMatch(text: string, pattern: RegExp) {
  const match = String(text || "").match(pattern);
  return String(match?.[1] || match?.[0] || "");
}

function extractImages(baseUrl: string, markdown: string) {
  const matches = String(markdown || "").matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);
  return Array.from(matches, (match) => absoluteUrl(baseUrl, match[1])).filter(Boolean);
}

function absoluteUrl(baseUrl: string, value: string) {
  try {
    return new URL(String(value || ""), baseUrl).toString();
  } catch {
    return "";
  }
}

function tagsFromHeading(value: string) {
  return splitTags(value, /[/&、，,|]+/);
}

function splitTags(value: string, separator: RegExp) {
  return Array.from(new Set(String(value || "").split(separator).map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function markdownPreview(images: string[]) {
  return images.filter(Boolean).map((image) => `![](${image})`).join("\n\n");
}

function leftPad(value: number) {
  return String(value).padStart(4, "0");
}

function safeUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("data:")) return text;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

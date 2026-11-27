/**
 * Runtime for user-authored prompt-source scripts. A script is an async function body that fetches
 * a remote list (markdown / json) and `return`s an array of prompt items. It runs with a set of flat
 * helper locals (see PROMPT_SOURCE_VARIABLES) so scripts stay short and declarative.
 */

import {
    absoluteUrl as resolveAbsoluteUrl,
    extractImages as resolveImages,
    firstMatch,
    leftPad,
    makePrompt as createRawPrompt,
    markdownPreview,
    parseEvolinkGptImage2CommercialMarkdown as parseEvolinkMarkdown,
    parseJamezBondosAwesomeGpt4oImagesMarkdown as parseJamezMarkdown,
    runTrustedPromptSource as runSharedPromptSource,
    splitSections,
    splitTags,
    tagsFromHeading,
    type RawPrompt,
} from "../../../../shared/trusted-prompt-sources";

export type { RawPrompt } from "../../../../shared/trusted-prompt-sources";

type RunOptions = { signal?: AbortSignal };
const PROMPT_FETCH_TIMEOUT_MS = 12_000;

const PROMPT_PROXY_PREFIXES: Record<string, string> = {
    "raw.githubusercontent.com": "/prompt-proxy/raw/",
    "pbs.twimg.com": "/prompt-proxy/pbs/",
    "img.shields.io": "/prompt-proxy/shields/",
    "api.star-history.com": "/prompt-proxy/star-history/",
    "awesome.re": "/prompt-proxy/awesome/",
    "atomgit.com": "/prompt-proxy/atomgit/",
};

function proxyPromptAssetUrl(value: string) {
    const input = String(value || "").trim();
    if (!input || input.startsWith("data:") || input.startsWith("/")) return input;
    try {
        const url = new URL(input, window.location.origin);
        const prefix = PROMPT_PROXY_PREFIXES[url.hostname.toLowerCase()];
        if (!prefix || !["http:", "https:"].includes(url.protocol)) return input;
        return `${prefix}${url.pathname.replace(/^\/+/, "")}${url.search}`;
    } catch {
        return input;
    }
}

function rewritePromptPreview(value: string) {
    return String(value || "").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => `![${alt}](${proxyPromptAssetUrl(url)})`);
}

export function normalizePromptAssets<T extends { coverUrl: string; preview: string }>(item: T): T {
    return { ...item, coverUrl: proxyPromptAssetUrl(item.coverUrl), preview: rewritePromptPreview(item.preview) };
}

async function fetchText(url: string, signal?: AbortSignal) {
    const proxied = proxyPromptAssetUrl(url);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), PROMPT_FETCH_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const response = await fetch(proxied, { cache: "no-store", signal: requestSignal }).finally(() => window.clearTimeout(timer));
    if (!response.ok) throw new Error(`${url} 拉取失败`);
    return response.text();
}

async function fetchJson<T = unknown>(url: string, signal?: AbortSignal) {
    return JSON.parse(await fetchText(url, signal)) as T;
}

function absoluteUrl(baseUrl: string, path: string) {
    return proxyPromptAssetUrl(resolveAbsoluteUrl(baseUrl, path));
}

function extractImages(baseUrl: string, markdown: string) {
    return resolveImages(baseUrl, markdown).map(proxyPromptAssetUrl);
}

function makePrompt(input: Parameters<typeof createRawPrompt>[0]) {
    return normalizePromptAssets(createRawPrompt(input));
}

/** Run a prompt-source script and normalize its result into a deduped RawPrompt[]. */
export async function runPromptSource(script: string, options?: RunOptions): Promise<RawPrompt[]> {
    const body = script.trim();
    if (!body) throw new Error("提示词来源脚本为空");
    const runner = new Function(
        "fetchText",
        "fetchJson",
        "splitSections",
        "firstMatch",
        "extractImages",
        "absoluteUrl",
        "tagsFromHeading",
        "splitTags",
        "markdownPreview",
        "leftPad",
        "makePrompt",
        "signal",
        `"use strict"; return (async () => {\n${body}\n})();`,
    ) as (...args: unknown[]) => Promise<unknown>;
    let result: unknown;
    try {
        result = await runner((url: string) => fetchText(url, options?.signal), (url: string) => fetchJson(url, options?.signal), splitSections, firstMatch, extractImages, absoluteUrl, tagsFromHeading, splitTags, markdownPreview, leftPad, makePrompt, options?.signal);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`提示词来源脚本执行失败：${message}`);
    }
    if (!Array.isArray(result)) throw new Error("提示词来源脚本需要 return 一个数组");
    const seen = new Set<string>();
    const items: RawPrompt[] = [];
    for (const raw of result) {
        if (!raw || typeof raw !== "object") continue;
        const record = raw as Record<string, unknown>;
        const title = String(record.title || "").trim();
        const prompt = String(record.prompt || "").trim();
        if (!title || !prompt) continue;
        const id = String(record.id || "").trim() || `prompt-${leftPad(items.length + 1)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(
            makePrompt({
                id,
                title,
                prompt,
                coverUrl: String(record.coverUrl || ""),
                tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).filter(Boolean) : [],
                preview: String(record.preview || ""),
                createdAt: String(record.createdAt || ""),
                updatedAt: String(record.updatedAt || ""),
            }),
        );
    }
    return items;
}

export async function runTrustedPromptSource(sourceId: string, options?: RunOptions): Promise<RawPrompt[]> {
    return (await runSharedPromptSource(sourceId, (url) => fetchText(url, options?.signal))).map(normalizePromptAssets);
}

export function parseEvolinkGptImage2CommercialMarkdown(...args: Parameters<typeof parseEvolinkMarkdown>) {
    return parseEvolinkMarkdown(...args).map(normalizePromptAssets);
}

export function parseJamezBondosAwesomeGpt4oImagesMarkdown(...args: Parameters<typeof parseJamezMarkdown>) {
    return parseJamezMarkdown(...args).map(normalizePromptAssets);
}

export type PromptSourceVariable = { name: string; type: string; desc: string };

/** Documentation surface shown in the prompt-source script editor. */
export const PROMPT_SOURCE_VARIABLES: PromptSourceVariable[] = [
    { name: "fetchText", type: "function", desc: "fetchText(url) 拉取纯文本（README 等），失败抛错" },
    { name: "fetchJson", type: "function", desc: "fetchJson(url) 拉取并解析 JSON" },
    { name: "splitSections", type: "function", desc: "splitSections(markdown, prefix) 按标题前缀（如 '### '）切分成段落数组" },
    { name: "firstMatch", type: "function", desc: "firstMatch(text, /正则/) 返回第一个捕获组，未匹配返回空串" },
    { name: "extractImages", type: "function", desc: "extractImages(baseUrl, markdown) 提取 markdown 图片并补全为绝对地址" },
    { name: "absoluteUrl", type: "function", desc: "absoluteUrl(baseUrl, path) 把相对路径拼成绝对 URL" },
    { name: "tagsFromHeading", type: "function", desc: "tagsFromHeading(heading) 从标题按 / & 、与 切出标签（小写去重前）" },
    { name: "splitTags", type: "function", desc: "splitTags(value, /分隔符/) 切分标签并转小写去空" },
    { name: "markdownPreview", type: "function", desc: "markdownPreview(images) 把图片数组拼成 markdown 预览文本" },
    { name: "leftPad", type: "function", desc: "leftPad(n) 数字左补零到 4 位，用于生成有序 id" },
    { name: "makePrompt", type: "function", desc: "makePrompt({id,title,prompt,coverUrl,tags,preview}) 构造一条提示词；title 和 prompt 必填" },
    { name: "signal", type: "AbortSignal", desc: "取消信号，可透传给需要的请求" },
];

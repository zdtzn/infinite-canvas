/**
 * Runtime for user-authored prompt-source scripts. A script is an async function body that fetches
 * a remote list (markdown / json) and `return`s an array of prompt items. It runs with a set of flat
 * helper locals (see PROMPT_SOURCE_VARIABLES) so scripts stay short and declarative.
 */

export type RawPrompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    preview: string;
    createdAt: string;
    updatedAt: string;
};

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

/** Split markdown into blocks, each starting at a line that begins with `prefix` (e.g. "## " / "### "). */
function splitSections(markdown: string, prefix: string) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of markdown.split("\n")) {
        if (line.startsWith(prefix) && current.length) {
            blocks.push(current.join("\n"));
            current = [];
        }
        current.push(line);
    }
    blocks.push(current.join("\n"));
    return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
    return pattern.exec(value)?.[1] || "";
}

function resolvePromptAssetUrl(baseUrl: string, path: string) {
    const input = String(path || "").trim().replace(/&amp;/gi, "&");
    if (!input) return "";
    try {
        return new URL(input, `${baseUrl.replace(/\/+$/, "")}/`).toString();
    } catch {
        return input;
    }
}

function absoluteUrl(baseUrl: string, path: string) {
    return proxyPromptAssetUrl(resolvePromptAssetUrl(baseUrl, path));
}

function extractImages(baseUrl: string, markdown: string) {
    const candidates: Array<{ index: number; path: string }> = [];
    const markdownImagePattern = /!\[(?:\\.|[^\]\\])*]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
    const htmlImagePattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))[^>]*>/gi;

    for (const match of markdown.matchAll(markdownImagePattern)) {
        candidates.push({ index: match.index, path: match[1] || match[2] });
    }
    for (const match of markdown.matchAll(htmlImagePattern)) {
        candidates.push({ index: match.index, path: match[1] || match[2] || match[3] });
    }

    const images = candidates
        .sort((left, right) => left.index - right.index)
        .map(({ path }) => resolvePromptAssetUrl(baseUrl, path))
        .filter(Boolean)
        .filter((url) => !isDecorativePromptImage(url))
        .map(proxyPromptAssetUrl);

    return Array.from(new Set(images));
}

function isDecorativePromptImage(value: string) {
    if (/^\/prompt-proxy\/(?:shields|star-history)\//i.test(value)) return true;
    try {
        const host = new URL(value, window.location.origin).hostname.toLowerCase();
        return host === "img.shields.io" || host === "api.star-history.com";
    } catch {
        return false;
    }
}

function splitTags(value: string, pattern: RegExp) {
    return value
        .split(pattern)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
}

function tagsFromHeading(heading: string) {
    return splitTags(heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""), /\s*(?:\/|&|、|与)\s*/);
}

function markdownPreview(images: string[]) {
    return images
        .filter(Boolean)
        .map((image) => `![](${image})`)
        .join("\n\n");
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}

function makePrompt(input: { id: string; title: string; prompt: string; coverUrl?: string; tags?: string[]; preview?: string; createdAt?: string; updatedAt?: string }): RawPrompt {
    return normalizePromptAssets({
        id: input.id,
        title: input.title,
        prompt: input.prompt,
        coverUrl: input.coverUrl || "",
        tags: input.tags || [],
        preview: input.preview || "",
        createdAt: input.createdAt || "",
        updatedAt: input.updatedAt || "",
    });
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
    if (sourceId === "davidwu-gpt-image2-prompts") return parseDavidWu(options);
    if (sourceId === "freestylefly-awesome-gpt-image-2") return parseFreestylefly(options);
    if (sourceId === "awesome-gpt-image") return parseAwesomeGptImage(options);
    if (sourceId === "awesome-gpt4o-image-prompts") return parseAwesomeGpt4o(options);
    if (sourceId === "youmind-gpt-image-2") return parseYouMind("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main", "youmind-gpt-image-2", "gpt-image-2", options);
    if (sourceId === "youmind-nano-banana-pro") return parseYouMind("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main", "youmind-nano-banana-pro", "nano-banana-pro", options);
    throw new Error("公网安全模式不允许运行自定义提示词脚本");
}

async function parseDavidWu(options?: RunOptions) {
    const base = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main";
    const data = await fetchJson<Array<Record<string, unknown>>>(`${base}/prompts.json`, options?.signal);
    return data.flatMap((item, index) => {
        const title = String(item.title_cn || item.title_en || "").trim();
        const prompt = String(item.prompt || "").trim();
        if (!title || !prompt) return [];
        const image = absoluteUrl(base, String(item.image || ""));
        const tags = splitTags([item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"), /\//);
        if (item.needs_ref) tags.push("需要参考图");
        const preview = [item.title_en, item.note, image ? `![](${image})` : ""].filter(Boolean).join("\n\n");
        return [makePrompt({ id: `davidwu-gpt-image2-prompts-${leftPad(Number(item.id) || index + 1)}`, title, prompt, coverUrl: image, tags, preview })];
    });
}

async function parseFreestylefly(options?: RunOptions) {
    const base = "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main";
    const items: RawPrompt[] = [];
    const promptPattern = /\*\*提示词：\*\*\s*\r?\n\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/;
    for (const file of ["docs/gallery-part-1.md", "docs/gallery-part-2.md"]) {
        const markdown = await fetchText(`${base}/${file}`, options?.signal);
        for (const block of splitSections(markdown, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m).trim();
            const prompt = firstMatch(block, promptPattern).trim();
            if (!title || !prompt) continue;
            const images = extractImages(`${base}/docs`, block);
            items.push(makePrompt({ id: `freestylefly-awesome-gpt-image-2-${leftPad(items.length + 1)}`, title, prompt, coverUrl: images[0] || "", tags: ["gpt-image-2", "freestylefly"], preview: markdownPreview(images) }));
        }
    }
    return items;
}

async function parseAwesomeGptImage(options?: RunOptions) {
    const base = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
    const markdown = await fetchText(`${base}/README.zh-CN.md`, options?.signal);
    const items: RawPrompt[] = [];
    for (const section of splitSections(markdown, "## ")) {
        const tags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
        for (const block of splitSections(section, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m).replace(/\[([^\]]+)]\([^)]+\)/g, "$1").trim();
            const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
            if (!title || !prompt) continue;
            const images = extractImages(base, block);
            items.push(makePrompt({ id: `awesome-gpt-image-${leftPad(items.length + 1)}`, title, prompt, coverUrl: images[0] || "", tags, preview: markdownPreview(images) }));
        }
    }
    return items;
}

async function parseAwesomeGpt4o(options?: RunOptions) {
    const base = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
    const markdown = await fetchText(`${base}/README.zh-CN.md`, options?.signal);
    const items: RawPrompt[] = [];
    for (const block of splitSections(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+(.+)$/m).trim();
        const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`(.*?)`/s).trim();
        if (!title || !prompt) continue;
        const images = extractImages(base, block);
        items.push(makePrompt({ id: `awesome-gpt4o-image-prompts-${leftPad(items.length + 1)}`, title, prompt, coverUrl: images[0] || "", tags: ["gpt4o"], preview: markdownPreview(images) }));
    }
    return items;
}

async function parseYouMind(base: string, idPrefix: string, modelTag: string, options?: RunOptions) {
    const markdown = await fetchText(`${base}/README_zh.md`, options?.signal);
    const items: RawPrompt[] = [];
    for (const block of splitSections(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
        const prompt = firstMatch(block, /#### .*?提示词\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
        if (!title || !prompt) continue;
        const images = extractImages(base, block);
        const prefix = title.match(/^(.+?) - /)?.[1] || "";
        items.push(makePrompt({ id: `${idPrefix}-${leftPad(items.length + 1)}`, title, prompt, coverUrl: images[0] || "", tags: [modelTag, ...tagsFromHeading(prefix)], preview: markdownPreview(images) }));
    }
    return items;
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

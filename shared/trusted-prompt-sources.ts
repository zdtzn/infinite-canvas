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

type PromptSourceFetchText = (url: string) => Promise<string>;

/** Split markdown into blocks, each starting at a line that begins with `prefix` (e.g. "## " / "### "). */
export function splitSections(markdown: string, prefix: string) {
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

export function firstMatch(value: string, pattern: RegExp) {
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

export function absoluteUrl(baseUrl: string, path: string) {
    return resolvePromptAssetUrl(baseUrl, path);
}

export function extractImages(baseUrl: string, markdown: string) {
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
        .filter((url) => !isDecorativePromptImage(url));

    return Array.from(new Set(images));
}

function isDecorativePromptImage(value: string) {
    if (/^\/prompt-proxy\/(?:shields|star-history)\//i.test(value)) return true;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === "img.shields.io" || host === "api.star-history.com";
    } catch {
        return false;
    }
}

export function splitTags(value: string, pattern: RegExp) {
    return value
        .split(pattern)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
}

export function tagsFromHeading(heading: string) {
    return splitTags(heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""), /\s*(?:\/|&|、|与)\s*/);
}

export function markdownPreview(images: string[]) {
    return images
        .filter(Boolean)
        .map((image) => `![](${image})`)
        .join("\n\n");
}

export function leftPad(value: number) {
    return String(value).padStart(4, "0");
}

export function makePrompt(input: { id: string; title: string; prompt: string; coverUrl?: string; tags?: string[]; preview?: string; createdAt?: string; updatedAt?: string }): RawPrompt {
    return {
        id: input.id,
        title: input.title,
        prompt: input.prompt,
        coverUrl: input.coverUrl || "",
        tags: input.tags || [],
        preview: input.preview || "",
        createdAt: input.createdAt || "",
        updatedAt: input.updatedAt || "",
    };
}

export async function runTrustedPromptSource(sourceId: string, fetchText: PromptSourceFetchText): Promise<RawPrompt[]> {
    if (sourceId === "banana-prompt-quicker") return parseStandardJsonSource("https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/banana-prompt-quicker.json", "banana-prompt-quicker", fetchText);
    if (sourceId === "davidwu-gpt-image2-prompts") return parseDavidWu(fetchText);
    if (sourceId === "freestylefly-awesome-gpt-image-2") return parseFreestylefly(fetchText);
    if (sourceId === "awesome-gpt-image") return parseAwesomeGptImage(fetchText);
    if (sourceId === "awesome-gpt4o-image-prompts") return parseAwesomeGpt4o(fetchText);
    if (sourceId === "evolink-gpt-image-2-commercial") return parseEvolinkGptImage2Commercial(fetchText);
    if (sourceId === "jamez-bondos-awesome-gpt4o-images") return parseJamezBondosAwesomeGpt4oImages(fetchText);
    if (sourceId === "youmind-gpt-image-2") return parseYouMind("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main", "youmind-gpt-image-2", "gpt-image-2", fetchText);
    if (sourceId === "youmind-nano-banana-pro") return parseYouMind("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main", "youmind-nano-banana-pro", "nano-banana-pro", fetchText);
    throw new Error("公网安全模式不允许运行自定义提示词脚本");
}

async function parseStandardJsonSource(url: string, idPrefix: string, fetchText: PromptSourceFetchText) {
    const data = JSON.parse(await fetchText(url)) as unknown;
    if (!Array.isArray(data)) throw new Error("标准提示词 JSON 的根节点必须是数组");
    return data.flatMap((value, index) => {
        const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const title = String(item.title || "").trim();
        const prompt = String(item.prompt || "").trim();
        if (!title || !prompt) throw new Error("提示词 JSON 存在缺少标题或内容的条目");
        const images = Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls.map((image) => absoluteUrl(url, String(image))).filter(Boolean) : [];
        const coverUrl = absoluteUrl(url, String(item.coverUrl || "")) || images[0] || "";
        const preview = [item.description, markdownPreview(images)].filter(Boolean).join("\n\n");
        return [
            makePrompt({
                id: String(item.id || `${idPrefix}-${leftPad(index + 1)}`),
                title,
                prompt,
                coverUrl,
                tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
                preview,
                createdAt: String(item.createdAt || ""),
                updatedAt: String(item.updatedAt || ""),
            }),
        ];
    });
}

async function parseDavidWu(fetchText: PromptSourceFetchText) {
    const base = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main";
    const data: unknown = JSON.parse(await fetchText(`${base}/prompts.json`));
    if (!Array.isArray(data)) throw new Error("标准提示词 JSON 的根节点必须是数组");
    return data.flatMap((value, index) => {
        const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const title = String(item.title_cn || item.title_en || "").trim();
        const prompt = String(item.prompt || "").trim();
        if (!title || !prompt) throw new Error("提示词 JSON 存在缺少标题或内容的条目");
        const image = absoluteUrl(base, String(item.image || ""));
        const tags = splitTags([item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"), /\//);
        if (item.needs_ref) tags.push("需要参考图");
        const preview = [item.title_en, item.note, image ? `![](${image})` : ""].filter(Boolean).join("\n\n");
        return [makePrompt({ id: `davidwu-gpt-image2-prompts-${leftPad(Number(item.id) || index + 1)}`, title, prompt, coverUrl: image, tags, preview })];
    });
}

async function parseFreestylefly(fetchText: PromptSourceFetchText) {
    const base = "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main";
    const items: RawPrompt[] = [];
    const promptPattern = /\*\*提示词：\*\*\s*\r?\n\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/;
    for (const file of ["docs/gallery-part-1.md", "docs/gallery-part-2.md"]) {
        const markdown = await fetchText(`${base}/${file}`);
        const previousCount = items.length;
        for (const block of splitSections(markdown, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m).trim();
            const prompt = firstMatch(block, promptPattern).trim();
            if (!title || !prompt) continue;
            const images = extractImages(`${base}/docs`, block);
            items.push(makePrompt({ id: `freestylefly-awesome-gpt-image-2-${leftPad(items.length + 1)}`, title, prompt, coverUrl: images[0] || "", tags: ["gpt-image-2", "freestylefly"], preview: markdownPreview(images) }));
        }
        if (items.length === previousCount) throw new Error(`来源文件 ${file} 没有可用提示词`);
    }
    return items;
}

async function parseAwesomeGptImage(fetchText: PromptSourceFetchText) {
    const base = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
    const markdown = await fetchText(`${base}/README.zh-CN.md`);
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

async function parseAwesomeGpt4o(fetchText: PromptSourceFetchText) {
    const base = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
    const markdown = await fetchText(`${base}/README.zh-CN.md`);
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

const EVOLINK_GPT_IMAGE_2_BASE = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main";
const EVOLINK_DUPLICATE_CASE_KEYS = new Set(["ad-creative:0107", "ad-creative:0108", "ad-creative:0109", "ad-creative:0112", "ad-creative:0171"]);

async function parseEvolinkGptImage2Commercial(fetchText: PromptSourceFetchText) {
    const categories = [
        { slug: "ecommerce" as const, file: "cases/ecommerce_zh-CN.md" },
        { slug: "ad-creative" as const, file: "cases/ad-creative_zh-CN.md" },
    ];
    const documents = await Promise.all(
        categories.map(async (category) => {
            let lastError: unknown;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    return { category, markdown: await fetchText(`${EVOLINK_GPT_IMAGE_2_BASE}/${category.file}`) };
                } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") throw error;
                    lastError = error;
                }
            }
            throw lastError;
        }),
    );
    return documents.flatMap(({ category, markdown }) => {
        const items = parseEvolinkGptImage2CommercialMarkdown(markdown, category.slug);
        if (!items.length) throw new Error(`来源文件 ${category.file} 没有可用提示词`);
        return items;
    });
}

export function parseEvolinkGptImage2CommercialMarkdown(markdown: string, category: "ecommerce" | "ad-creative", base = EVOLINK_GPT_IMAGE_2_BASE) {
    const meta = category === "ecommerce" ? { label: "电商设计", taxonomy: "商品商业" } : { label: "广告创意", taxonomy: "平面设计" };
    const items: RawPrompt[] = [];
    const seenIds = new Set<string>();
    for (const block of splitSections(markdown, "### ")) {
        const heading = block.match(/^###\s+Case\s+(\d+):\s+\[([^\]]+)]\(([^)]+)\)\s+\(by\s+\[@([^\]]+)]\(([^)]+)\)\)\s*$/m);
        if (!heading) continue;
        const prompt = firstMatch(block, /\*\*提示词[：:]\*\*\s*\r?\n\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/).trim();
        const normalizedBlock = block.replace(/\.\.\/\.\.\/images\//g, "../images/");
        const images = extractImages(`${base}/cases`, normalizedBlock);
        const coverUrl = images.find((image) => /\/output(?:[-_.\d]|$)/i.test(image)) || images[0] || "";
        if (!prompt || !coverUrl) continue;
        const assetCaseId = firstMatch(coverUrl, /_case(\d+)\//i) || heading[1];
        const caseKey = `${category}:${leftPad(Number(assetCaseId))}`;
        if (EVOLINK_DUPLICATE_CASE_KEYS.has(caseKey)) continue;
        const id = `evolink-gpt-image-2-commercial-${category}-${leftPad(Number(assetCaseId))}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const tags = ["gpt-image-2", meta.taxonomy];
        if (/上传|uploaded image|provided reference|reference image|use the uploaded image/i.test(prompt)) tags.push("需要参考图");
        const attribution = [`原作者：@${heading[4]}`, `原始案例：${heading[3]}`].join("\n");
        items.push(
            makePrompt({
                id,
                title: `${meta.label} · ${heading[2].trim()}`,
                prompt,
                coverUrl,
                tags,
                preview: [attribution, markdownPreview(images.slice(0, 4))].filter(Boolean).join("\n\n"),
            }),
        );
    }
    return items;
}

async function parseJamezBondosAwesomeGpt4oImages(fetchText: PromptSourceFetchText) {
    const base = "https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main";
    const markdown = await fetchText(`${base}/README.md`);
    return parseJamezBondosAwesomeGpt4oImagesMarkdown(markdown, base);
}

export function parseJamezBondosAwesomeGpt4oImagesMarkdown(markdown: string, base = "https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main") {
    const items: RawPrompt[] = [];
    const casePattern = /(?:^|\n)###\s+案例\s*(\d+)[：:]\s*(.+)\r?\n([\s\S]*?)(?=\r?\n###\s+案例\s*\d+[：:]|\s*$)/g;
    for (const match of markdown.matchAll(casePattern)) {
        const block = match[3];
        const prompt = firstMatch(block, /\*\*提示词\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();
        if (!prompt) continue;
        const images = extractImages(base, block);
        const tags = ["gpt-4o", "gpt-image-1"];
        if (/需上传参考图片/.test(block)) tags.push("需要参考图");
        items.push(
            makePrompt({
                id: `jamez-bondos-awesome-gpt4o-images-${leftPad(Number(match[1]))}`,
                title: match[2].replace(/\s+\(by\s+.*$/i, "").trim(),
                prompt,
                coverUrl: images[0] || "",
                tags,
                preview: markdownPreview(images),
            }),
        );
    }
    return items;
}

async function parseYouMind(base: string, idPrefix: string, modelTag: string, fetchText: PromptSourceFetchText) {
    const markdown = await fetchText(`${base}/README_zh.md`);
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

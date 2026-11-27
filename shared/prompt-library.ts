export type PromptMedia = "image" | "video";
export type PromptOrder = "asc" | "desc" | "relevance";
export type PromptUsage = { media: PromptMedia | "general"; requiresReference: boolean };
export type PromptOrigin = { sourceId?: string; title: string; category: string; githubUrl: string };

export function tokenizePromptKeyword(keyword: string): string[] {
    return [...new Set(keyword.trim().toLowerCase().split(/\s+/).filter(Boolean))];
}

export function promptTitleMatchRank(title: string, terms: readonly string[]): number {
    if (!terms.length) return 0;
    const normalized = title.trim().toLowerCase();
    const phrase = terms.join(" ");
    if (normalized === phrase) return 3;
    if (normalized.startsWith(phrase)) return 2;
    return terms.every((term) => normalized.includes(term)) ? 1 : 0;
}

export function getPromptSearchText({ title, prompt, category, tags, sourceTags = [] }: { title: string; prompt: string; category: string; tags: readonly string[]; sourceTags?: readonly string[] }) {
    return [title, prompt, category, ...tags, ...sourceTags].join(" ").toLowerCase();
}

const videoUsage = /视频模板|视频生成|视频提示词|文生视频|图生视频|视频转视频|\b(?:video (?:template|generation|prompt)|(?:text|image|video)[- ]to[- ]video)\b/i;
const videoInstruction = /\b(?:generate|create|produce)\s+(?:a\s+)?(?:\d+(?:\.\d+)?[- ]second\s+)?(?:short\s+)?video\b|(?:生成|制作)一段(?:短)?视频/i;
const imageUsage = /图像编辑|图片模板|图像提示词|图片生成|文生图|图生图|\b(?:image (?:template|generation|edit|prompt)|(?:text|image)[- ]to[- ]image|gpt-image-[\w.-]+|nano[- ]banana(?:[- ]pro)?)\b/i;
const imageInstruction = /\b(?:generate|create|produce)\s+(?:an?\s+)?(?:high[- ]quality\s+)?image\b|(?:生成|制作)一张(?:图片|图像)/i;
const referenceTag = /^(?:需要参考图|需要上传参考图|需参考图|需上传参考图片|needs[_ -]ref|reference image required)$/i;
const referenceInstruction = /\b(?:use|using|based on|from)\s+(?:(?:the|an?|your)\s+)?(?:(?:provided|uploaded|input)\s+)?(?:reference\s+(?:image|photo)|(?:uploaded|input)\s+(?:image|photo))\b|(?:必须|需要|请|需)上传参考(?:图片|图像|图)|基于(?:所提供的|上传的)?参考图/i;

export function getPromptUsage({ title, prompt, tags }: { title: string; prompt: string; tags: readonly string[] }): PromptUsage {
    const description = [title, ...tags].join("\n");
    const media = videoUsage.test(description) || videoInstruction.test(prompt)
        ? "video"
        : imageUsage.test(description) || imageInstruction.test(prompt) ? "image" : "general";
    const requiresReference = tags.some((tag) => referenceTag.test(tag.trim())) || referenceInstruction.test(prompt);
    return { media, requiresReference };
}

export function mergePromptUsage(entries: readonly PromptUsage[]): PromptUsage {
    const specific = new Set(entries.map(({ media }) => media).filter((media) => media !== "general"));
    const [media] = specific;
    return {
        media: specific.size === 1 && media ? media : "general",
        requiresReference: entries.some(({ requiresReference }) => requiresReference),
    };
}

type PromptMatch = PromptOrigin & { prompt: string; tags: string[]; sourceTags?: string[]; usage?: PromptUsage; sources?: PromptOrigin[] };

export function searchLocalPrompts<T extends PromptMatch>(items: readonly T[], filter: { sourceId: string; category: string; tags: string[]; terms: readonly string[]; media?: PromptMedia; order: PromptOrder }) {
    const filtered = items.filter((item) => {
        if (filter.sourceId && item.sourceId !== filter.sourceId) return false;
        if (filter.category && filter.category !== "全部" && filter.category !== "all" && item.category !== filter.category) return false;
        if (filter.tags.length && !filter.tags.some((tag) => item.tags.includes(tag))) return false;
        if (filter.media) {
            const { media } = item.usage ?? getPromptUsage({ ...item, tags: item.sourceTags ?? item.tags });
            if (media !== "general" && media !== filter.media) return false;
        }
        if (!filter.terms.length) return true;
        const haystack = getPromptSearchText(item);
        return filter.terms.every((term) => haystack.includes(term));
    });
    if (filter.order !== "asc") filtered.reverse();
    if (filter.order === "relevance" && filter.terms.length) {
        filtered.sort((left, right) => promptTitleMatchRank(right.title, filter.terms) - promptTitleMatchRank(left.title, filter.terms));
    }
    return filtered;
}

export function mergeCrossSourcePrompts<T extends PromptMatch>(items: readonly T[], sourceScope: readonly T[] = items): Array<T & Pick<PromptMatch, "sources" | "usage">> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        if (!groups.has(item.prompt)) groups.set(item.prompt, [item]);
    }
    for (const item of sourceScope) {
        const group = groups.get(item.prompt);
        if (group && group[0] !== item) group.push(item);
    }
    const merged = new Map<string, T>();
    for (const [prompt, matches] of groups) {
        if (matches.length < 2) continue;
        const sources = new Map<string, PromptOrigin>();
        for (const { sourceId, title, category, githubUrl } of matches) {
            const key = sourceId || category;
            if (!sources.has(key)) sources.set(key, { sourceId, title, category, githubUrl });
        }
        if (sources.size < 2) continue;
        merged.set(prompt, { ...matches[0], sources: [...sources.values()], usage: mergePromptUsage(matches.map((entry) => entry.usage ?? getPromptUsage({ ...entry, tags: entry.sourceTags ?? entry.tags }))) });
    }
    const emitted = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
        const combined = merged.get(item.prompt);
        if (!combined) result.push(item);
        else if (!emitted.has(item.prompt)) {
            result.push(combined);
            emitted.add(item.prompt);
        }
    }
    return result;
}

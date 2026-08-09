import localforage from "localforage";

import { normalizePromptAssets, runPromptSource, runTrustedPromptSource, type RawPrompt } from "./prompt-source-runtime";
import { isBuiltInPromptSource, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "./prompt-source-presets";
import { classifyPromptTags, sortPromptTaxonomyTags } from "./prompt-taxonomy";
import { PUBLIC_MODE } from "@/constant/runtime-config";

export type Prompt = RawPrompt & {
    category: string;
    githubUrl: string;
    sourceTags?: string[];
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
};

export const PROMPT_SOURCE_CACHE_TTL_MS = 1000 * 60 * 60;
const promptCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" });

type SourceCache = PromptSourceStatus & { items: Prompt[]; fetchedAt: number; signature: string };
export type PromptSourceCacheState = "missing" | "invalid" | "fresh" | "stale";

const loadingSources = new Map<string, Promise<Prompt[]>>();

const sourceCacheRevisions: Record<string, string> = {
    "youmind-gpt-image-2": "html-content-images-v1",
    "youmind-nano-banana-pro": "html-content-images-v1",
};

function enabledSources() {
    return usePromptSourceStore.getState().sources.filter((source) => source.enabled && (!PUBLIC_MODE || source.trusted));
}

export function promptSourceCacheKey(sourceId: string) {
    return `prompt-source:v2:${sourceId}`;
}

export function promptSourceCacheRevision(sourceId: string) {
    return sourceCacheRevisions[sourceId] || "";
}

/** Describes whether a cached source can be used without waiting for a remote refresh. */
export function promptSourceCacheState(cached: Pick<SourceCache, "items" | "fetchedAt" | "signature"> | null | undefined, signature: string, now = Date.now()): PromptSourceCacheState {
    if (!cached || !Array.isArray(cached.items)) return "missing";
    if (cached.signature !== signature) return "invalid";
    return now - cached.fetchedAt < PROMPT_SOURCE_CACHE_TTL_MS ? "fresh" : "stale";
}

/** Cheap stable signature of a source so cached prompts invalidate when the script or name changes. */
function sourceSignature(source: PromptSource) {
    const revision = promptSourceCacheRevision(source.id);
    const value = `${revision ? `${revision}\n` : ""}${source.name}\n${source.githubUrl}\n${source.script}`;
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return `${value.length}:${hash}`;
}

function withSourceMeta(source: PromptSource, items: RawPrompt[]): Prompt[] {
    return items.map((item) => ({ ...normalizePromptAssets(item), category: source.name, githubUrl: source.githubUrl }));
}

async function runSource(source: PromptSource): Promise<Prompt[]> {
    const items = PUBLIC_MODE && isBuiltInPromptSource(source) ? await runTrustedPromptSource(source.id) : await runPromptSource(source.script);
    const prompts = withSourceMeta(source, items);
    const fetchedAt = Date.now();
    await promptCacheStore.setItem<SourceCache>(promptSourceCacheKey(source.id), {
        sourceId: source.id,
        items: prompts,
        count: prompts.length,
        fetchedAt,
        lastSuccessAt: new Date(fetchedAt).toISOString(),
        lastError: "",
        signature: sourceSignature(source),
    });
    return prompts;
}

function cachedPromptItems(cached: SourceCache) {
    return cached.items.map(normalizePromptAssets);
}

function refreshSourceCache(source: PromptSource, cached: SourceCache | null, signature: string): Promise<Prompt[]> {
    const inFlight = loadingSources.get(source.id);
    if (inFlight) return inFlight;

    const loading = runSource(source)
        .catch(async (error) => {
            const lastError = error instanceof Error ? error.message : String(error);
            const hasMatchingCache = cached?.signature === signature;
            await promptCacheStore.setItem<SourceCache>(promptSourceCacheKey(source.id), {
                sourceId: source.id,
                items: hasMatchingCache ? cached.items || [] : [],
                count: hasMatchingCache ? cached.items?.length || 0 : 0,
                fetchedAt: hasMatchingCache ? cached.fetchedAt || 0 : 0,
                lastSuccessAt: hasMatchingCache ? cached.lastSuccessAt || "" : "",
                lastError,
                signature,
            });
            throw error;
        })
        .finally(() => loadingSources.delete(source.id));
    loadingSources.set(source.id, loading);
    return loading;
}

async function getSourcePrompts(source: PromptSource, force = false): Promise<Prompt[]> {
    const signature = sourceSignature(source);
    const cached = await promptCacheStore.getItem<SourceCache>(promptSourceCacheKey(source.id));
    const cacheState = promptSourceCacheState(cached, signature);
    if (!force && cached?.items?.length && cacheState === "fresh") return cachedPromptItems(cached);
    if (!force && cached?.items?.length && cacheState === "stale") {
        // Preserve a responsive gallery while the source refreshes for the next visit.
        void refreshSourceCache(source, cached, signature).catch(() => undefined);
        return cachedPromptItems(cached);
    }
    return refreshSourceCache(source, cached, signature);
}

/** Aggregate prompts across all enabled sources; a failing source is skipped so others still load. */
async function getAllPrompts(): Promise<Prompt[]> {
    const settled = await Promise.all(
        enabledSources().map(async (source) => {
            try {
                return await getSourcePrompts(source);
            } catch {
                return [];
            }
        }),
    );
    return settled.flat();
}

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    const items = (await getAllPrompts()).map(withPromptTaxonomy);
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const withoutTagFilter = filterPrompts(items, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories: enabledSources().map((source) => source.name),
        total: filtered.length,
    };
}

/** Load a single source's prompts (used by the source content table). Throws so the caller can show the error. */
export async function fetchSourcePrompts(sourceId: string, force = false): Promise<Prompt[]> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("提示词来源不存在");
    return (await getSourcePrompts(source, force)).map(withPromptTaxonomy);
}

/** Force refetch one source and refresh its cache; returns the fetched count. */
export async function refreshSource(sourceId: string): Promise<number> {
    const items = await fetchSourcePrompts(sourceId, true);
    return items.length;
}

/** Force refetch every enabled source; returns the total prompt count. */
export async function refreshAllSources(): Promise<number> {
    const settled = await Promise.all(
        enabledSources().map(async (source) => {
            try {
                return await getSourcePrompts(source, true);
            } catch {
                return [];
            }
        }),
    );
    return settled.reduce((total, items) => total + items.length, 0);
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    const entries = await Promise.all(
        usePromptSourceStore.getState().sources.map(async (source) => {
            const cached = await promptCacheStore.getItem<SourceCache>(promptSourceCacheKey(source.id));
            return [
                source.id,
                {
                    sourceId: source.id,
                    count: cached?.items?.length || 0,
                    lastSuccessAt: cached?.lastSuccessAt || "",
                    lastError: cached?.lastError || "",
                },
            ] as const;
        }),
    );
    return Object.fromEntries(entries);
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.category, ...item.tags, ...(item.sourceTags || [])].join(" ").toLowerCase().includes(options.keyword);
    });
}

function collectTags(items: Prompt[]) {
    return sortPromptTaxonomyTags(Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean))));
}

function withPromptTaxonomy(item: Prompt): Prompt {
    const sourceTags = item.sourceTags?.length ? item.sourceTags : item.tags;
    return { ...item, sourceTags, tags: classifyPromptTags({ title: item.title, prompt: item.prompt, tags: sourceTags }) };
}

function isActiveOption(value: string) {
    return value && value !== "全部" && value !== "all";
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

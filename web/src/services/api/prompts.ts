import localforage from "localforage";

import { normalizePromptAssets, runPromptSource, type RawPrompt } from "./prompt-source-runtime";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "./prompt-source-presets";
import { classifyPromptTags, isPromptTaxonomyTag, sortPromptTaxonomyTags } from "./prompt-taxonomy";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { serverRequest } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { getPromptUsage, mergeCrossSourcePrompts, searchLocalPrompts, tokenizePromptKeyword, type PromptMedia, type PromptOrder, type PromptOrigin, type PromptUsage } from "../../../../shared/prompt-library";

export type Prompt = RawPrompt & {
    sourceId?: string;
    category: string;
    githubUrl: string;
    sourceTags?: string[];
    usage?: PromptUsage;
    sources?: PromptOrigin[];
};
export type PromptCover = Pick<Prompt, "id" | "title" | "coverUrl" | "category">;

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
    page: number;
    pageSize: number;
    indexed?: boolean;
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
    refreshing?: boolean;
};

export const PROMPT_SOURCE_CACHE_TTL_MS = 1000 * 60 * 60;
const PROMPT_INITIAL_LOAD_BUDGET_MS = 2_500;
export const PROMPT_LIBRARY_UPDATED_EVENT = "infinite-canvas:prompt-library-updated";
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
    return items.map((item) => ({ ...normalizePromptAssets(item), sourceId: source.id, category: source.name, githubUrl: source.githubUrl }));
}

async function runSource(source: PromptSource): Promise<Prompt[]> {
    const items = PUBLIC_MODE
        ? (await serverRequest<{ items: RawPrompt[] }>(`/api/prompt-sources/${encodeURIComponent(source.id)}/items`, { timeoutMs: 20_000, expectedUserId: useUserStore.getState().user?.id })).items
        : await runPromptSource(source.script);
    if (!items.length) throw new Error("提示词来源未返回有效条目");
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
    notifyPromptLibraryUpdated(source.id);
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
    const settled = await Promise.all(enabledSources().map(loadSourceWithinBudget));
    return settled.flat();
}

async function loadSourceWithinBudget(source: PromptSource): Promise<Prompt[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            getSourcePrompts(source).catch(() => [] as Prompt[]),
            new Promise<Prompt[]>((resolve) => { timer = setTimeout(() => resolve([]), PROMPT_INITIAL_LOAD_BUDGET_MS); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** The homepage previews images only; keep source order without fetching prompt bodies. */
export async function fetchHomepagePromptCovers(): Promise<PromptCover[]> {
    const sources = enabledSources();
    if (!sources.length) return [];
    if (PUBLIC_MODE) {
        try {
            const requests = [];
            for (let offset = 0; offset < sources.length; offset += 100) {
                const params = new URLSearchParams();
                sources.slice(offset, offset + 100).forEach((source) => params.append("sourceId", source.id));
                requests.push(serverRequest<{ items: Array<Omit<PromptCover, "category"> & { sourceId: string }>; indexedSourceIds: string[]; enabledSourceIds: string[] }>(`/api/prompt-index/covers?${params}`, { timeoutMs: 2_500, expectedUserId: useUserStore.getState().user?.id }));
            }
            const responses = await Promise.all(requests);
            const enabled = new Set(responses.flatMap((response) => response.enabledSourceIds ?? []));
            const indexed = new Set(responses.flatMap((response) => response.indexedSourceIds));
            const bySource = new Map<string, PromptCover[]>();
            const currentSources = sources.filter((source) => enabled.has(source.id));
            const sourceById = new Map(currentSources.map((source) => [source.id, source]));
            for (const item of responses.flatMap((response) => response.items)) {
                const source = sourceById.get(item.sourceId);
                if (!source) continue;
                const group = bySource.get(source.id) || [];
                group.push({ id: item.id, title: item.title, coverUrl: normalizePromptAssets({ coverUrl: item.coverUrl, preview: "" }).coverUrl, category: source.name });
                bySource.set(source.id, group);
            }
            return (await Promise.all(currentSources.map(async (source) => indexed.has(source.id) ? bySource.get(source.id) || [] : (await loadSourceWithinBudget(source)).map(toPromptCover)))).flat();
        } catch {
            return [];
        }
    }
    return (await getAllPrompts()).map(toPromptCover);
}

function toPromptCover(item: Prompt): PromptCover {
    return { id: item.id, title: item.title, coverUrl: item.coverUrl, category: item.category };
}

function normalizeIndexedPrompt(item: Prompt): Prompt {
    return normalizePromptAssets({
        ...item,
        usage: item.usage ?? getPromptUsage({ ...item, tags: [...(item.sourceTags ?? []), ...item.tags] }),
    });
}

export async function fetchPrompts({ sourceId = "", keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20, order = keyword.trim() ? "relevance" : "desc", media }: { sourceId?: string; keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number; order?: PromptOrder; media?: PromptMedia } = {}): Promise<PromptListResponse> {
    const serverResult = await fetchPromptIndex({ sourceId, keyword, tag, category, page, pageSize, order, media });
    if (serverResult) return { ...serverResult, items: serverResult.items.map(normalizeIndexedPrompt), tags: sortPromptTaxonomyTags(serverResult.tags.filter(isPromptTaxonomyTag)) };
    if (PUBLIC_MODE) throw new Error("提示词库暂不可用，请稍后重试");
    const items = (await getAllPrompts()).map(withPromptTaxonomy);
    const terms = tokenizePromptKeyword(keyword);
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const filter = { sourceId, category, terms, media, order };
    const withoutTagFilter = searchLocalPrompts(items, { ...filter, tags: [] });
    const matches = tag.length ? searchLocalPrompts(items, { ...filter, tags: tag }) : withoutTagFilter;
    const sourceScope = terms.length || tag.length ? searchLocalPrompts(items, { ...filter, tags: [], terms: [] }) : matches;
    const filtered = mergeCrossSourcePrompts(matches, sourceScope);

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories: enabledSources().map((source) => source.name),
        total: filtered.length,
        page: normalizedPage,
        pageSize: normalizedPageSize,
    };
}

type PromptIndexRequest = { sourceId?: string; keyword: string; tag: string[]; category: string; page: number; pageSize: number; order?: PromptOrder; media?: PromptMedia };

export function buildPromptIndexQuery({ sourceId = "", keyword, tag, category, page, pageSize, order, media }: PromptIndexRequest) {
    const params = new URLSearchParams({ sourceId, keyword, category, page: String(page), pageSize: String(pageSize) });
    for (const value of tag) params.append("tag", value);
    if (order) params.set("order", order);
    if (media) params.set("media", media);
    return params;
}

async function fetchPromptIndex(options: PromptIndexRequest) {
    const params = buildPromptIndexQuery(options);
    try {
        return await serverRequest<PromptListResponse>(`/api/prompt-index?${params.toString()}`, { timeoutMs: 5_000, expectedUserId: useUserStore.getState().user?.id });
    } catch {
        return null;
    }
}

/** Load the complete prompt library across every enabled source. */
export async function fetchAllPrompts(): Promise<Prompt[]> {
    if (PUBLIC_MODE) {
        const items: Prompt[] = [];
        for (let page = 1; ; page += 1) {
            const result = await fetchPrompts({ page, pageSize: 100 });
            items.push(...result.items);
            if (!result.items.length || items.length >= result.total) return items;
        }
    }
    return (await getAllPrompts()).map(withPromptTaxonomy);
}

/** Load a single source's prompts (used by the source content table). Throws so the caller can show the error. */
export async function fetchSourcePrompts(sourceId: string): Promise<Prompt[]> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("提示词来源不存在");
    if (PUBLIC_MODE) {
        const items: Prompt[] = [];
        for (let page = 1; ; page += 1) {
            const result = await fetchPromptIndex({ sourceId: source.id, keyword: "", tag: [], category: ALL_PROMPTS_OPTION, page, pageSize: 100 });
            if (!result) throw new Error("提示词索引暂不可用，请稍后重试");
            if (!result.indexed) return [];
            items.push(...result.items.map(normalizeIndexedPrompt));
            if (!result.items.length || items.length >= result.total) break;
        }
        return items;
    }
    return (await getSourcePrompts(source)).map(withPromptTaxonomy);
}

export async function fetchPromptIndexStatuses(): Promise<PromptSourceStatus[]> {
    const response = await serverRequest<{ items: PromptSourceStatus[] }>("/api/admin/prompt-index/status", { timeoutMs: 12_000, expectedUserId: useUserStore.getState().user?.id });
    return response.items;
}

type PromptSourceRefreshResult = PromptSourceStatus & { name: string; success: boolean };
type PromptRefreshSummary = { count: number; succeeded: number; failed: number };

async function requestPromptIndexRefresh(sourceId?: string) {
    const response = await serverRequest<{ results: PromptSourceRefreshResult[] }>("/api/admin/prompt-index/refresh", {
        method: "POST",
        body: sourceId ? { sourceId } : {},
        timeoutMs: sourceId ? 30_000 : 225_000,
        expectedUserId: useUserStore.getState().user?.id,
    });
    return response.results;
}

export function notifyPromptLibraryUpdated(sourceId?: string) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROMPT_LIBRARY_UPDATED_EVENT, { detail: { sourceId } }));
}

/** Force a single enabled source to refresh and return its newly indexed count. */
export async function refreshSource(sourceId: string): Promise<number> {
    if (PUBLIC_MODE) {
        const [result] = await requestPromptIndexRefresh(sourceId);
        if (!result?.success) throw new Error(result?.lastError || "提示词来源刷新失败");
        notifyPromptLibraryUpdated(sourceId);
        return result.count;
    }
    const source = enabledSources().find((item) => item.id === sourceId);
    if (!source) throw new Error("提示词来源不存在或已停用");
    return (await getSourcePrompts(source, true)).length;
}

/** Force every enabled source to refresh and report the actual outcomes. */
export async function refreshAllSources(): Promise<PromptRefreshSummary> {
    if (PUBLIC_MODE) {
        const results = await requestPromptIndexRefresh();
        const succeeded = results.filter((result) => result.success);
        if (succeeded.length) notifyPromptLibraryUpdated();
        return { count: succeeded.reduce((total, result) => total + result.count, 0), succeeded: succeeded.length, failed: results.length - succeeded.length };
    }
    const results = await Promise.allSettled(enabledSources().map((source) => getSourcePrompts(source, true)));
    const succeeded = results.filter((result) => result.status === "fulfilled");
    return { count: succeeded.reduce((total, result) => total + result.value.length, 0), succeeded: succeeded.length, failed: results.length - succeeded.length };
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    if (PUBLIC_MODE) return Object.fromEntries((await fetchPromptIndexStatuses()).map((status) => [status.sourceId, status]));
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

function collectTags(items: Prompt[]) {
    return sortPromptTaxonomyTags(Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean))));
}

function withPromptTaxonomy(item: Prompt): Prompt {
    const sourceTags = item.sourceTags?.length ? item.sourceTags : item.tags;
    const tags = classifyPromptTags({ title: item.title, prompt: item.prompt, tags: sourceTags });
    const usage = item.usage ?? getPromptUsage({ ...item, tags: [...sourceTags, ...tags] });
    return { ...item, sourceTags, tags, usage };
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

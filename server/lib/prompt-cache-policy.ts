export const DEFAULT_PROMPT_CACHE_MAX_ENTRIES = 2_000;
export const DEFAULT_PROMPT_THUMBNAIL_PROXY_CONCURRENCY = 6;

export type PromptProxyLane = "asset" | "thumbnail";

/** Keep image transforms from occupying the same queue as source manifests and original assets. */
export function promptProxyLane(pathname: string): PromptProxyLane {
    return pathname.startsWith("/prompt-proxy/thumbnail/") ? "thumbnail" : "asset";
}

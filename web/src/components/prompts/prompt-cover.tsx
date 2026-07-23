import { ImageOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const PROXY_SOURCE_HOSTS: Record<string, string> = {
    pbs: "pbs.twimg.com",
    awesome: "awesome.re",
    atomgit: "atomgit.com",
};
const IMAGE_LOAD_TIMEOUT_MS = 8_000;

export function promptOriginalUrl(value?: string) {
    const input = String(value || "").trim();
    if (!input) return input;

    const rawUrlMatch = input.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
    if (rawUrlMatch) {
        const [, owner, repo, ref, path] = rawUrlMatch;
        return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`;
    }

    const rawMatch = input.match(/^\/prompt-proxy\/raw\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (rawMatch) {
        const [, owner, repo, ref, path] = rawMatch;
        return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`;
    }

    const proxyMatch = input.match(/^\/prompt-proxy\/([^/]+)\/(.+)$/);
    if (proxyMatch && PROXY_SOURCE_HOSTS[proxyMatch[1]]) {
        return `https://${PROXY_SOURCE_HOSTS[proxyMatch[1]]}/${proxyMatch[2]}`;
    }
    return input;
}

export function promptThumbnailUrl(value?: string, width = 640) {
    const input = String(value || "").trim();
    if (!input || input.startsWith("data:") || input.startsWith("blob:") || input.startsWith("https://images.weserv.nl/")) return input;
    const source = promptOriginalUrl(input);
    if (!/^https?:\/\//i.test(source)) return input;
    return `https://images.weserv.nl/?url=${encodeURIComponent(source)}&w=${width}&h=${width}&fit=inside&q=78&output=webp`;
}

export function promptServerThumbnailUrl(value?: string, width = 640) {
    const thumbnail = promptThumbnailUrl(value, width);
    if (!thumbnail.startsWith("https://images.weserv.nl/")) return thumbnail;
    return `/prompt-proxy/thumbnail/${thumbnail.slice("https://images.weserv.nl/".length)}`;
}

export function promptOriginalCandidates(value?: string) {
    const input = String(value || "").trim();
    return uniqueUrls([input, promptOriginalUrl(input)]);
}

export function promptImageCandidates(value?: string, width = 640) {
    return uniqueUrls([promptServerThumbnailUrl(value, width), ...promptOriginalCandidates(value), promptThumbnailUrl(value, width)]);
}

function uniqueUrls(values: Array<string | undefined>) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

type CoverStatus = { sourceKey: string; index: number; failed: boolean; loaded: boolean; retry: number };

function initialCoverStatus(sourceKey: string): CoverStatus {
    return { sourceKey, index: 0, failed: false, loaded: false, retry: 0 };
}

export function PromptCover({ sources, alt, className, loading = "lazy", fetchPriority = "auto", timeoutMs = IMAGE_LOAD_TIMEOUT_MS }: { sources?: string[]; alt: string; className: string; loading?: "eager" | "lazy"; fetchPriority?: "high" | "low" | "auto"; timeoutMs?: number }) {
    const candidates = uniqueUrls(sources || []);
    const sourceKey = candidates.join("\n");
    const [status, setStatus] = useState<CoverStatus>(() => initialCoverStatus(sourceKey));
    const activeStatus = status.sourceKey === sourceKey ? status : initialCoverStatus(sourceKey);
    const currentSrc = candidates[activeStatus.index];
    const advanceSource = useCallback(() => {
        setStatus((current) => {
            const next = current.sourceKey === sourceKey ? current : initialCoverStatus(sourceKey);
            if (next.index + 1 < candidates.length) return { ...next, index: next.index + 1, loaded: false };
            return { ...next, failed: true, loaded: false };
        });
    }, [candidates.length, sourceKey]);

    useEffect(() => {
        if (!currentSrc || activeStatus.failed || activeStatus.loaded) return;
        const timeout = window.setTimeout(advanceSource, timeoutMs);
        return () => window.clearTimeout(timeout);
    }, [activeStatus.failed, activeStatus.index, activeStatus.loaded, advanceSource, currentSrc, timeoutMs]);

    if (!currentSrc) {
        return (
            <div className={`${className} flex flex-col items-center justify-center gap-2 bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500`} role="img" aria-label={`${alt}源内容未提供图片`}>
                <ImageOff className="size-6" aria-hidden="true" />
                <span className="text-xs">源内容未提供图片</span>
            </div>
        );
    }

    if (activeStatus.failed) {
        return (
            <div className={`${className} flex flex-col items-center justify-center gap-2 bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500`} role="img" aria-label={`${alt}图片加载失败`}>
                <ImageOff className="size-6" aria-hidden="true" />
                <span className="text-xs">图片加载失败</span>
                <button
                    type="button"
                    title="重新加载"
                    aria-label="重新加载图片"
                    className="flex size-8 items-center justify-center rounded border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
                    onClick={() => setStatus({ sourceKey, index: 0, failed: false, loaded: false, retry: activeStatus.retry + 1 })}
                >
                    <RotateCcw className="size-4" />
                </button>
            </div>
        );
    }

    return (
        <img
            key={`${sourceKey}:${activeStatus.index}:${activeStatus.retry}`}
            src={currentSrc}
            alt={alt}
            className={className}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => {
                setStatus((current) => {
                    const next = current.sourceKey === sourceKey ? current : initialCoverStatus(sourceKey);
                    return next.index === activeStatus.index && !next.failed ? { ...next, loaded: true } : current;
                });
            }}
            onError={advanceSource}
        />
    );
}

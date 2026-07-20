import { ImageOff } from "lucide-react";
import { useState } from "react";

const PROXY_SOURCE_HOSTS: Record<string, string> = {
    pbs: "pbs.twimg.com",
    awesome: "awesome.re",
    atomgit: "atomgit.com",
};

export function promptOriginalUrl(value?: string) {
    const input = String(value || "").trim();
    if (!input) return input;

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

type CoverStatus = { src?: string; fallbackActive: boolean; failed: boolean };

export function PromptCover({ src, fallbackSrc, alt, className, loading = "lazy", fetchPriority = "auto" }: { src?: string; fallbackSrc?: string; alt: string; className: string; loading?: "eager" | "lazy"; fetchPriority?: "high" | "low" | "auto" }) {
    const [status, setStatus] = useState<CoverStatus>({ src, fallbackActive: false, failed: !src });
    const sourceChanged = status.src !== src;
    const currentSrc = !sourceChanged && status.fallbackActive ? fallbackSrc : src;
    const failed = sourceChanged ? !src : status.failed;

    if (failed) {
        return (
            <div className={`${className} flex flex-col items-center justify-center gap-2 bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500`} role="img" aria-label={`${alt}暂无图片预览`}>
                <ImageOff className="size-6" aria-hidden="true" />
                <span className="text-xs">暂无图片预览</span>
            </div>
        );
    }

    return (
        <img
            key={currentSrc}
            src={currentSrc}
            alt={alt}
            className={className}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setStatus({ src, fallbackActive: Boolean(fallbackSrc && currentSrc === fallbackSrc), failed: false })}
            onError={() => {
                if (fallbackSrc && currentSrc !== fallbackSrc) {
                    setStatus({ src, fallbackActive: true, failed: false });
                    return;
                }
                setStatus({ src, fallbackActive: false, failed: true });
            }}
        />
    );
}

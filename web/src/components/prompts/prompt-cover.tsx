import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

const PROXY_SOURCE_HOSTS: Record<string, string> = {
    raw: "raw.githubusercontent.com",
    pbs: "pbs.twimg.com",
    awesome: "awesome.re",
    atomgit: "atomgit.com",
};

function thumbnailSource(value: string) {
    const proxyMatch = value.match(/^\/prompt-proxy\/([^/]+)\/(.+)$/);
    if (proxyMatch && PROXY_SOURCE_HOSTS[proxyMatch[1]]) {
        return `https://${PROXY_SOURCE_HOSTS[proxyMatch[1]]}/${proxyMatch[2]}`;
    }
    return value;
}

export function promptThumbnailUrl(value?: string, width = 640) {
    const input = String(value || "").trim();
    if (!input || input.startsWith("data:") || input.startsWith("blob:") || input.startsWith("https://images.weserv.nl/")) return input;
    const source = thumbnailSource(input);
    if (!/^https?:\/\//i.test(source)) return input;
    return `https://images.weserv.nl/?url=${encodeURIComponent(source)}&w=${width}&h=${width}&fit=inside&q=78&output=webp`;
}

export function PromptCover({ src, fallbackSrc, alt, className }: { src?: string; fallbackSrc?: string; alt: string; className: string }) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [failed, setFailed] = useState(!src);

    useEffect(() => {
        setCurrentSrc(src);
        setFailed(!src);
    }, [src]);

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
            src={currentSrc}
            alt={alt}
            className={className}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
                if (fallbackSrc && currentSrc !== fallbackSrc) {
                    setCurrentSrc(fallbackSrc);
                    return;
                }
                setFailed(true);
            }}
        />
    );
}

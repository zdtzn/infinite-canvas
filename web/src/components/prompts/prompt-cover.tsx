import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

export function PromptCover({ src, alt, className }: { src?: string; alt: string; className: string }) {
    const [failed, setFailed] = useState(!src);

    useEffect(() => {
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

    return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

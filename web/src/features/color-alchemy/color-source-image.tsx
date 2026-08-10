import { useEffect, useState, type ImgHTMLAttributes } from "react";

import { resolveImageUrl } from "@/services/image-storage";

type StoredColorImageSource = {
    url: string;
    storageKey?: string;
};

export function ColorSourceImage({ source, alt, className, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { source: StoredColorImageSource }) {
    const [src, setSrc] = useState(source.storageKey ? "" : source.url);

    useEffect(() => {
        let cancelled = false;
        setSrc(source.storageKey ? "" : source.url);
        void resolveImageUrl(source.storageKey, source.url)
            .then((resolved) => {
                if (!cancelled) setSrc(resolved || source.url);
            })
            .catch(() => {
                if (!cancelled) setSrc(source.url);
            });
        return () => {
            cancelled = true;
        };
    }, [source.storageKey, source.url]);

    if (!src) return <span role="img" aria-label={alt} className={`${className || ""} block bg-white/4`} />;
    return <img {...props} src={src} alt={alt} className={className} />;
}

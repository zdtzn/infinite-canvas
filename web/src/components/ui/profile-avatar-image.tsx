import { type CSSProperties, type ImgHTMLAttributes, type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

type ProfileAvatarImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    src?: string | null;
    fallback: ReactNode;
    fallbackClassName?: string;
    imageClassName?: string;
    containerStyle?: CSSProperties;
};

export function ProfileAvatarImage({ src, alt = "", fallback, className, fallbackClassName, imageClassName, containerStyle, loading = "lazy", decoding = "async", ...imageProps }: ProfileAvatarImageProps) {
    const normalizedSrc = src?.trim() || "";
    const [loadedSrc, setLoadedSrc] = useState("");
    const loaded = Boolean(normalizedSrc && loadedSrc === normalizedSrc);

    return (
        <span className={cn("relative isolate grid shrink-0 place-items-center overflow-hidden", className)} style={containerStyle}>
            <span className={cn("grid size-full place-items-center", fallbackClassName)} aria-hidden="true">
                {fallback}
            </span>
            {normalizedSrc ? (
                <img
                    {...imageProps}
                    src={normalizedSrc}
                    alt={alt}
                    loading={loading}
                    decoding={decoding}
                    className={cn("absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200", loaded && "opacity-100", imageClassName)}
                    onLoad={(event) => {
                        if (event.currentTarget.naturalWidth > 0) setLoadedSrc(normalizedSrc);
                        imageProps.onLoad?.(event);
                    }}
                    onError={(event) => {
                        setLoadedSrc("");
                        imageProps.onError?.(event);
                    }}
                />
            ) : null}
        </span>
    );
}

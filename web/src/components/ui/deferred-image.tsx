import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

type DeferredImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "loading" | "decoding"> & {
    src: string;
    rootMargin?: string;
};

export function DeferredImage({ src, rootMargin = "160px 0px", ...imageProps }: DeferredImageProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [visibleSrc, setVisibleSrc] = useState("");
    const resolvedSrc = visibleSrc === src ? src : undefined;

    useEffect(() => {
        const image = imageRef.current;
        if (!src || !image) return;
        const margin = Number.parseFloat(rootMargin) || 0;
        let revealed = false;
        let observer: IntersectionObserver | undefined;
        let unsubscribePositionCheck: () => void = () => undefined;
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            setVisibleSrc(src);
            observer?.disconnect();
            unsubscribePositionCheck();
        };
        const checkPosition = () => {
            if (isNearViewport(image, margin)) reveal();
        };

        checkPosition();
        if (revealed) return;
        if (typeof IntersectionObserver === "undefined") {
            reveal();
            return;
        }

        observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                reveal();
            },
            { rootMargin },
        );
        observer.observe(image);
        unsubscribePositionCheck = subscribeVisibilityCheck(checkPosition);
        return () => {
            observer?.disconnect();
            unsubscribePositionCheck();
        };
    }, [rootMargin, src]);

    return <img {...imageProps} ref={imageRef} src={resolvedSrc} loading="lazy" decoding="async" data-image-deferred={resolvedSrc ? "loaded" : "waiting"} />;
}

function isNearViewport(element: HTMLElement, margin: number) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= -margin && rect.top <= window.innerHeight + margin && rect.right >= -margin && rect.left <= window.innerWidth + margin;
}

const visibilityChecks = new Set<() => void>();
let visibilityCheckTimer: number | undefined;

function subscribeVisibilityCheck(check: () => void) {
    visibilityChecks.add(check);
    if (visibilityChecks.size === 1) {
        document.addEventListener("scroll", scheduleVisibilityChecks, true);
        window.addEventListener("resize", scheduleVisibilityChecks, { passive: true });
    }
    return () => {
        visibilityChecks.delete(check);
        if (visibilityChecks.size) return;
        document.removeEventListener("scroll", scheduleVisibilityChecks, true);
        window.removeEventListener("resize", scheduleVisibilityChecks);
        if (visibilityCheckTimer !== undefined) {
            window.clearTimeout(visibilityCheckTimer);
            visibilityCheckTimer = undefined;
        }
    };
}

function scheduleVisibilityChecks() {
    if (visibilityCheckTimer !== undefined) return;
    visibilityCheckTimer = window.setTimeout(() => {
        visibilityCheckTimer = undefined;
        [...visibilityChecks].forEach((check) => check());
    }, 0);
}

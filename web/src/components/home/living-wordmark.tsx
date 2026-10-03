import { useEffect, useId, useRef, type CSSProperties } from "react";

import "./living-wordmark.css";

const PARTICLES = Array.from({ length: 28 }, (_, index) => {
    const outer = index % 2 === 1;
    return {
        outer,
        size: index % 11 === 0 ? 3 : index % 3 === 0 ? 2 : 1,
        opacity: outer ? 0.14 + (index % 4) * 0.035 : 0.22 + (index % 5) * 0.055,
        duration: outer ? 68 + (index % 5) * 4 : 42 + (index % 4) * 3,
        phase: ((index * 0.618034) % 1).toFixed(4),
        radius: outer ? 50 + (index % 3) : 43 + (index % 3),
        height: outer ? 17 + (index % 3) * 0.6 : 12 + (index % 3) * 0.6,
        mobile: index < 14,
    };
});

// Coordinates follow the existing image's brush tips, not arbitrary screen positions.
const SPARKS = [
    { x: 26.6, y: 17.8, dx: -15, dy: -13, duration: 19 },
    { x: 34.7, y: 67, dx: 12, dy: 19, duration: 23 },
    { x: 48.2, y: 66, dx: 19, dy: 10, duration: 27 },
    { x: 65.5, y: 26, dx: 17, dy: -15, duration: 29 },
    { x: 79, y: 8, dx: 11, dy: -21, duration: 31 },
    { x: 79, y: 66, dx: 16, dy: 12, duration: 37 },
];

export function LivingWordmark({ className, sizes }: { className: string; sizes: string }) {
    const rootRef = useRef<HTMLHeadingElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const trackGradientId = useId();

    useEffect(() => {
        const root = rootRef.current;
        const image = imageRef.current;
        if (!root || !image) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const hoverAvailable = window.matchMedia("(hover: hover) and (pointer: fine)");
        let inView = typeof IntersectionObserver === "undefined";
        let rateFrame = 0;
        let hoverSheen: Animation | undefined;
        const resizeObserver = new ResizeObserver(([entry]) => root.style.setProperty("--wordmark-unit", `${entry.contentRect.width / 100}px`));

        const orbitAnimations = () => Array.from(root.querySelectorAll<HTMLElement>("[data-wordmark-orbit]")).flatMap((particle) => particle.getAnimations());
        const resetInteraction = () => {
            cancelAnimationFrame(rateFrame);
            rateFrame = 0;
            root.dataset.hovered = "false";
            hoverSheen?.cancel();
            orbitAnimations().forEach((animation) => animation.updatePlaybackRate(1));
        };
        const syncActivity = () => {
            const active = inView && !document.hidden && !reducedMotion.matches && root.dataset.ready === "true";
            root.dataset.active = String(active);
            if (!active) resetInteraction();
        };
        const imageReady = () => {
            if (!image.naturalWidth) return;
            // Reuse the browser-selected, already cached responsive image for the alpha mask.
            root.style.setProperty("--wordmark-mask", `url("${image.currentSrc || image.src}")`);
            root.dataset.ready = "true";
            syncActivity();
        };
        const easeOrbitSpeed = (targetRate: number) => {
            cancelAnimationFrame(rateFrame);
            const animations = orbitAnimations();
            if (!animations.length) return;
            const startingRates = animations.map((animation) => animation.playbackRate);
            const start = performance.now();
            const step = (now: number) => {
                const progress = Math.min((now - start) / 800, 1);
                const eased = progress * progress * (3 - 2 * progress);
                animations.forEach((animation, index) => animation.updatePlaybackRate(startingRates[index] + (targetRate - startingRates[index]) * eased));
                rateFrame = progress < 1 ? requestAnimationFrame(step) : 0;
            };
            // Only this short hover transition uses JS frames; steady motion is compositor driven.
            rateFrame = requestAnimationFrame(step);
        };
        const enter = (event: PointerEvent) => {
            if (event.pointerType !== "mouse" || !hoverAvailable.matches || root.dataset.active !== "true") return;
            root.dataset.hovered = "true";
            easeOrbitSpeed(1.18);
            hoverSheen?.cancel();
            hoverSheen = root.querySelector<HTMLElement>("[data-wordmark-hover-sheen]")?.animate(
                [
                    { transform: "translate(-85%, 28%)", opacity: 0, offset: 0 },
                    { transform: "translate(-60%, 20%)", opacity: 0.16, offset: 0.16 },
                    { transform: "translate(60%, -20%)", opacity: 0.16, offset: 0.84 },
                    { transform: "translate(85%, -28%)", opacity: 0, offset: 1 },
                ],
                { duration: 2600, easing: "ease-in-out" },
            );
        };
        const leave = () => {
            root.dataset.hovered = "false";
            if (root.dataset.active === "true") easeOrbitSpeed(1);
        };
        const observer =
            typeof IntersectionObserver === "undefined"
                ? undefined
                : new IntersectionObserver(
                      ([entry]) => {
                          inView = entry.isIntersecting;
                          syncActivity();
                      },
                      { threshold: 0 },
                  );

        root.querySelectorAll<HTMLElement>("[data-wordmark-spark]").forEach((spark, index) => spark.style.setProperty("--spark-delay", `${4 + index * 3.3 + Math.random() * 2}s`));
        root.style.setProperty("--wordmark-unit", `${root.clientWidth / 100}px`);
        resizeObserver.observe(root);
        observer?.observe(root);
        image.addEventListener("load", imageReady);
        document.addEventListener("visibilitychange", syncActivity);
        reducedMotion.addEventListener("change", syncActivity);
        hoverAvailable.addEventListener("change", resetInteraction);
        root.addEventListener("pointerenter", enter);
        root.addEventListener("pointerleave", leave);
        if (image.complete) imageReady();

        return () => {
            observer?.disconnect();
            resizeObserver.disconnect();
            image.removeEventListener("load", imageReady);
            document.removeEventListener("visibilitychange", syncActivity);
            reducedMotion.removeEventListener("change", syncActivity);
            hoverAvailable.removeEventListener("change", resetInteraction);
            root.removeEventListener("pointerenter", enter);
            root.removeEventListener("pointerleave", leave);
            cancelAnimationFrame(rateFrame);
            hoverSheen?.cancel();
        };
    }, []);

    return (
        <h1 ref={rootRef} className={`living-wordmark ${className}`} data-active="false" data-ready="false" data-hovered="false">
            <span className="sr-only">无限画布</span>
            <span className="wordmark-halo-strength" aria-hidden="true">
                <span className="wordmark-halo" />
            </span>
            <img
                ref={imageRef}
                className="wordmark-image"
                src="/images/infinite-canvas-wordmark.webp"
                srcSet="/images/infinite-canvas-wordmark-mobile.webp 840w, /images/infinite-canvas-wordmark.webp 1680w"
                sizes={sizes}
                width={1680}
                height={560}
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="async"
            />
            <span className="wordmark-effects" aria-hidden="true">
                <span className="wordmark-mask wordmark-idle-sheen">
                    <span className="wordmark-sheen" />
                </span>
                <span className="wordmark-mask">
                    <span className="wordmark-sheen wordmark-hover-sheen" data-wordmark-hover-sheen />
                </span>
                <span className="wordmark-mask wordmark-tracks-mask">
                    <svg className="wordmark-tracks" viewBox="0 0 1680 560" fill="none" focusable="false">
                        <defs>
                            <linearGradient id={trackGradientId}>
                                <stop stopColor="#f5dfaa" stopOpacity="0" />
                                <stop offset="0.45" stopColor="#fff1c8" />
                                <stop offset="1" stopColor="#f5dfaa" stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        {/* Short highlights register with the baked-in lines; no additional rings. */}
                        <g stroke={`url(#${trackGradientId})`} strokeWidth="2" strokeLinecap="round">
                            <path d="M366 92 C168 135 92 183 197 202" />
                            <path d="M1371 94 C1645 16 1686 164 1583 270 C1537 313 1454 352 1407 383" />
                            <path d="M814 395 C1093 495 1270 454 1378 433" />
                        </g>
                    </svg>
                </span>
                {[false, true].map((outer) => (
                    <span key={String(outer)} className={`wordmark-orbit-field ${outer ? "is-outer" : "is-inner"}`}>
                        {PARTICLES.filter((particle) => particle.outer === outer).map((particle, index) => (
                            <span
                                key={index}
                                className={`wordmark-particle${particle.mobile ? " is-mobile" : ""}`}
                                data-wordmark-orbit
                                style={
                                    {
                                        "--particle-size": `${particle.size}px`,
                                        "--particle-opacity": particle.opacity,
                                        "--orbit-duration": `${particle.duration}s`,
                                        "--orbit-delay": `${-Number(particle.phase) * particle.duration}s`,
                                        "--orbit-x": `calc(var(--wordmark-unit) * ${particle.radius})`,
                                        "--orbit-y": `calc(var(--wordmark-unit) * ${particle.height})`,
                                    } as CSSProperties
                                }
                            />
                        ))}
                    </span>
                ))}
                {SPARKS.map((spark, index) => (
                    <span
                        key={index}
                        className={`wordmark-spark${index % 2 === 0 ? " is-mobile" : ""}`}
                        data-wordmark-spark
                        style={{ left: `${spark.x}%`, top: `${spark.y}%`, "--spark-x": `${spark.dx}px`, "--spark-y": `${spark.dy}px`, "--spark-duration": `${spark.duration}s` } as CSSProperties}
                    />
                ))}
            </span>
        </h1>
    );
}

import { ImageOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { runWithConcurrency } from "@/lib/async-pool";
import { distributeDriftWallItems, driftWallColumnFactor, driftWallCopyCount, resolveDriftWallHoverId } from "./drift-wall-layout";
import "./drift-wall.css";

export type DriftWallItem = {
    id: string;
    title: string;
    imageSources: string[];
    originalIndex: number;
};

type DriftWallProps = {
    items: DriftWallItem[];
    onItemClick?: (item: DriftWallItem, originalIndex: number) => void;
    onHoverChange?: (hovered: boolean) => void;
    columns?: number;
    tileWidth?: number;
    tileHeight?: number;
    gap?: number;
    radius?: number;
    tilt?: number;
    turn?: number;
    roll?: number;
    perspective?: number;
    depth?: number;
    speed?: number;
    direction?: "up" | "down";
    variance?: number;
    parallax?: number;
    pauseOnHover?: boolean;
    lift?: number;
    fade?: number;
    dim?: number;
    grayscale?: boolean;
    overlayColor?: string;
    className?: string;
    style?: CSSProperties;
    ariaLabel?: string;
};

type DriftWallCssProperties = CSSProperties & Record<`--dw-${string}`, string | number>;
type DriftWallImageStatus = { state: "loading" | "loaded" | "failed"; url?: string };

const DRIFT_WALL_IMAGE_TIMEOUT_MS = 9_000;

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function positiveModulo(value: number, modulus: number) {
    return ((value % modulus) + modulus) % modulus;
}

function driftWallImageKey(item: DriftWallItem) {
    return `${item.id}\n${item.imageSources.join("\n")}`;
}

function canLoadImage(source: string) {
    return new Promise<boolean>((resolve) => {
        const image = new Image();
        let settled = false;
        const timeout = window.setTimeout(() => finish(false), DRIFT_WALL_IMAGE_TIMEOUT_MS);
        const finish = (loaded: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            image.onload = null;
            image.onerror = null;
            resolve(loaded);
        };

        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = source;
    });
}

async function resolveDriftWallImageSource(sources: string[]) {
    for (const source of sources) {
        if (await canLoadImage(source)) return source;
    }
    return undefined;
}

export function DriftWall({
    items,
    onItemClick,
    onHoverChange,
    columns = 5,
    tileWidth = 210,
    tileHeight = 148,
    gap = 18,
    radius = 6,
    tilt = 9,
    turn = -9,
    roll = 0,
    perspective = 1500,
    depth = 72,
    speed = 24,
    direction = "up",
    variance = 0.32,
    parallax = 0.55,
    pauseOnHover = false,
    lift = 42,
    fade = 0.46,
    dim = 0.64,
    grayscale = false,
    overlayColor = "#08090c",
    className = "",
    style,
    ariaLabel = "功法精选画卷",
}: DriftWallProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const planeRef = useRef<HTMLDivElement | null>(null);
    const trackRefs = useRef<Array<HTMLDivElement | null>>([]);
    const frameRef = useRef<number | null>(null);
    const offsetsRef = useRef<number[]>([]);
    const velocitiesRef = useRef<number[]>([]);
    const hoveredColumnRef = useRef(-1);
    const wallHoveredRef = useRef(false);
    const pointerRef = useRef({ x: 0, y: 0 });
    const dampedPointerRef = useRef({ x: 0, y: 0 });
    const lastTimestampRef = useRef<number | null>(null);
    const activeIdRef = useRef<string | null>(null);
    const activeBoundsRef = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null);
    const imageStatusesRef = useRef<Record<string, DriftWallImageStatus>>({});
    const imageRequestTokensRef = useRef(new Map<string, symbol>());

    const [containerSize, setContainerSize] = useState({ width: 1200, height: 620 });
    const [activeId, setActiveId] = useState<string | null>(null);
    const [imageStatuses, setImageStatuses] = useState<Record<string, DriftWallImageStatus>>({});
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
    const [isInView, setIsInView] = useState(() => typeof IntersectionObserver === "undefined");
    const [isPageVisible, setIsPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
        setReducedMotion(media.matches);
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), { rootMargin: "160px 0px" });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => setIsPageVisible(document.visibilityState !== "hidden");
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    useEffect(
        () => () => {
            imageRequestTokensRef.current.clear();
            onHoverChange?.(false);
        },
        [onHoverChange],
    );

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            setContainerSize({ width: rect.width || 1200, height: rect.height || 620 });
        };

        updateSize();
        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateSize);
            return () => window.removeEventListener("resize", updateSize);
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const updateImageStatus = useCallback((key: string, status: DriftWallImageStatus) => {
        const nextStatuses = { ...imageStatusesRef.current, [key]: status };
        imageStatusesRef.current = nextStatuses;
        setImageStatuses(nextStatuses);
    }, []);

    const loadItemImage = useCallback(
        async (item: DriftWallItem, force = false) => {
            const key = driftWallImageKey(item);
            const currentStatus = imageStatusesRef.current[key];
            if (!force && (currentStatus?.state === "loading" || currentStatus?.state === "loaded")) return;

            const requestToken = Symbol(key);
            imageRequestTokensRef.current.set(key, requestToken);
            updateImageStatus(key, { state: "loading" });
            const resolvedSource = await resolveDriftWallImageSource(item.imageSources);
            if (imageRequestTokensRef.current.get(key) !== requestToken) return;
            imageRequestTokensRef.current.delete(key);
            updateImageStatus(key, resolvedSource ? { state: "loaded", url: resolvedSource } : { state: "failed" });
        },
        [updateImageStatus],
    );

    useEffect(() => {
        if (!isInView) return;
        void runWithConcurrency(items, 8, async (item) => loadItemImage(item)).catch(() => undefined);
    }, [isInView, items, loadItemImage]);

    const responsiveScale = containerSize.width < 560 ? 0.76 : containerSize.width < 900 ? 0.88 : 1;
    const responsiveColumns = containerSize.width < 560 ? Math.min(columns, 3) : containerSize.width < 900 ? Math.min(columns, 4) : columns;
    const activeTileWidth = Math.round(tileWidth * responsiveScale);
    const activeTileHeight = Math.round(tileHeight * responsiveScale);
    const activeGap = Math.max(12, Math.round(gap * responsiveScale));

    const columnItems = useMemo(() => distributeDriftWallItems(items, responsiveColumns), [items, responsiveColumns]);
    const columnMeta = useMemo(() => {
        const tileUnitHeight = activeTileHeight + activeGap;
        return columnItems.map((column) => driftWallCopyCount(column.length, tileUnitHeight, containerSize.height));
    }, [activeGap, activeTileHeight, columnItems, containerSize.height]);

    const baseVelocities = useMemo(() => {
        const directionSign = direction === "up" ? 1 : -1;
        return columnItems.map((_, columnIndex) => {
            const alternatingSign = columnIndex % 2 === 0 ? 1 : -1;
            return speed * driftWallColumnFactor(columnIndex, variance) * directionSign * alternatingSign;
        });
    }, [columnItems, direction, speed, variance]);

    useLayoutEffect(() => {
        offsetsRef.current = columnMeta.map((meta, columnIndex) => {
            const previousOffset = offsetsRef.current[columnIndex];
            return Number.isFinite(previousOffset) ? positiveModulo(previousOffset, meta.copyHeight) : meta.copyHeight * ((columnIndex * 0.37) % 1);
        });
        velocitiesRef.current = columnItems.map((_, columnIndex) => velocitiesRef.current[columnIndex] ?? 0);
        trackRefs.current.length = columnItems.length;

        trackRefs.current.forEach((track, columnIndex) => {
            if (track) track.style.transform = `translate3d(0, ${-(offsetsRef.current[columnIndex] ?? 0)}px, 0)`;
        });
    }, [columnItems, columnMeta]);

    const applyPlaneTransform = useCallback(
        (pointerX: number, pointerY: number) => {
            if (!planeRef.current) return;
            const planeScale = containerSize.width < 560 ? 1.12 : 1.08;
            planeRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${planeScale}) ` + `rotateX(${tilt + pointerY}deg) rotateY(${turn + pointerX}deg) rotateZ(${roll}deg) translateZ(${-depth}px)`;
        },
        [containerSize.width, depth, roll, tilt, turn],
    );

    useLayoutEffect(() => {
        applyPlaneTransform(0, 0);
    }, [applyPlaneTransform]);

    useEffect(() => {
        if (!isInView || !isPageVisible || reducedMotion) {
            applyPlaneTransform(0, 0);
            return;
        }

        const animate = (timestamp: number) => {
            if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp;
            const deltaSeconds = Math.min(0.05, Math.max(0, timestamp - lastTimestampRef.current) / 1000);
            lastTimestampRef.current = timestamp;

            const maxPointerTilt = parallax * 7;
            const tileActive = activeIdRef.current !== null;
            const targetX = tileActive ? dampedPointerRef.current.x : pointerRef.current.x * maxPointerTilt;
            const targetY = tileActive ? dampedPointerRef.current.y : -pointerRef.current.y * maxPointerTilt;
            const pointerEase = 1 - Math.exp(-deltaSeconds / 0.12);
            dampedPointerRef.current.x += (targetX - dampedPointerRef.current.x) * pointerEase;
            dampedPointerRef.current.y += (targetY - dampedPointerRef.current.y) * pointerEase;
            applyPlaneTransform(dampedPointerRef.current.x, dampedPointerRef.current.y);

            trackRefs.current.forEach((track, columnIndex) => {
                const meta = columnMeta[columnIndex];
                if (!track || !meta) return;

                const shouldPause = (wallHoveredRef.current && pauseOnHover) || hoveredColumnRef.current === columnIndex;
                const targetVelocity = shouldPause ? 0 : baseVelocities[columnIndex];
                const velocityEase = 1 - Math.exp(-deltaSeconds / (targetVelocity === 0 ? 0.16 : 0.28));
                velocitiesRef.current[columnIndex] += (targetVelocity - velocitiesRef.current[columnIndex]) * velocityEase;

                const nextOffset = positiveModulo((offsetsRef.current[columnIndex] ?? 0) + velocitiesRef.current[columnIndex] * deltaSeconds, meta.copyHeight);
                offsetsRef.current[columnIndex] = nextOffset;
                track.style.transform = `translate3d(0, ${-nextOffset}px, 0)`;
            });

            frameRef.current = window.requestAnimationFrame(animate);
        };

        frameRef.current = window.requestAnimationFrame(animate);
        return () => {
            if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            lastTimestampRef.current = null;
        };
    }, [applyPlaneTransform, baseVelocities, columnMeta, isInView, isPageVisible, parallax, pauseOnHover, reducedMotion]);

    const activate = useCallback((id: string, columnIndex: number, element?: HTMLElement) => {
        activeIdRef.current = id;
        if (element) {
            const bounds = element.getBoundingClientRect();
            activeBoundsRef.current = { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        }
        hoveredColumnRef.current = columnIndex;
        velocitiesRef.current[columnIndex] = 0;
        setActiveId(id);
    }, []);

    const release = useCallback((id?: string) => {
        if (id && activeIdRef.current !== id) return;
        activeIdRef.current = null;
        activeBoundsRef.current = null;
        hoveredColumnRef.current = -1;
        setActiveId(null);
    }, []);

    const handlePointerMove = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.pointerType !== "mouse") return;

            const candidateElement = event.target instanceof Element ? event.target.closest<HTMLElement>(".drift-wall__tile") : null;
            const candidateId = candidateElement?.dataset.driftTileId || null;
            const nextActiveId = resolveDriftWallHoverId({
                activeId: activeIdRef.current,
                candidateId,
                point: { x: event.clientX, y: event.clientY },
                activeBounds: activeBoundsRef.current,
            });

            if (nextActiveId !== activeIdRef.current) {
                const columnIndex = Number(candidateElement?.dataset.driftColumnIndex);
                if (nextActiveId && candidateElement && candidateId === nextActiveId && Number.isInteger(columnIndex)) {
                    activate(nextActiveId, columnIndex, candidateElement);
                } else if (!nextActiveId) {
                    release();
                }
            }

            if (parallax <= 0 || reducedMotion) return;
            const rect = event.currentTarget.getBoundingClientRect();
            pointerRef.current = {
                x: (event.clientX - rect.left) / rect.width - 0.5,
                y: (event.clientY - rect.top) / rect.height - 0.5,
            };
        },
        [activate, parallax, reducedMotion, release],
    );

    const handlePointerLeaveWall = useCallback(() => {
        wallHoveredRef.current = false;
        pointerRef.current = { x: 0, y: 0 };
        release();
        onHoverChange?.(false);
    }, [onHoverChange, release]);

    const handlePointerEnterWall = useCallback(() => {
        wallHoveredRef.current = true;
        onHoverChange?.(true);
    }, [onHoverChange]);

    const handleTileKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>, item: DriftWallItem) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onItemClick?.(item, item.originalIndex);
        },
        [onItemClick],
    );

    const cssVariables = useMemo<DriftWallCssProperties>(
        () => ({
            "--dw-tile-w": `${activeTileWidth}px`,
            "--dw-tile-h": `${activeTileHeight}px`,
            "--dw-gap": `${activeGap}px`,
            "--dw-radius": `${radius}px`,
            "--dw-perspective": `${perspective}px`,
            "--dw-lift": `${lift}px`,
            "--dw-dim": dim,
            "--dw-gray": grayscale ? 1 : 0,
            "--dw-overlay": overlayColor,
            "--dw-edge-opacity": Math.min(0.94, Math.max(0.35, fade + 0.42)),
            ...style,
        }),
        [activeGap, activeTileHeight, activeTileWidth, dim, fade, grayscale, lift, overlayColor, perspective, radius, style],
    );

    const rootClassName = ["drift-wall", reducedMotion ? "drift-wall--reduced" : "", className].filter(Boolean).join(" ");

    return (
        <div ref={containerRef} className={rootClassName} style={cssVariables} onPointerMove={handlePointerMove} onPointerEnter={handlePointerEnterWall} onPointerLeave={handlePointerLeaveWall} role="group" aria-label={ariaLabel}>
            <div ref={planeRef} className="drift-wall__plane">
                {columnItems.map((column, columnIndex) => {
                    const meta = columnMeta[columnIndex];
                    const copies = Array.from({ length: meta?.copies ?? 2 });

                    return (
                        <div className="drift-wall__column" key={`column-${columnIndex}`}>
                            <div
                                className="drift-wall__track"
                                ref={(element) => {
                                    trackRefs.current[columnIndex] = element;
                                }}
                            >
                                {copies.map((_, copyIndex) =>
                                    column.map((item, itemIndex) => {
                                        const tileId = `${columnIndex}-${copyIndex}-${item.id}-${itemIndex}`;
                                        const imageStatus = imageStatuses[driftWallImageKey(item)];
                                        return (
                                            <div
                                                key={tileId}
                                                className={`drift-wall__tile${activeId === tileId ? " is-active" : ""}`}
                                                data-drift-tile-id={tileId}
                                                data-drift-column-index={columnIndex}
                                                role="button"
                                                tabIndex={copyIndex === 0 ? 0 : -1}
                                                aria-label={`预览功法：${item.title}`}
                                                aria-hidden={copyIndex === 0 ? undefined : true}
                                                onClick={() => onItemClick?.(item, item.originalIndex)}
                                                onKeyDown={(event) => handleTileKeyDown(event, item)}
                                                onFocus={(event) => activate(tileId, columnIndex, event.currentTarget)}
                                                onBlur={() => release(tileId)}
                                            >
                                                <div className="drift-wall__inner">
                                                    {imageStatus?.state === "loaded" && imageStatus.url ? (
                                                        <img src={imageStatus.url} alt={item.title} className="drift-wall__image" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
                                                    ) : imageStatus?.state === "failed" ? (
                                                        <div className="drift-wall__image drift-wall__image--failed" role="img" aria-label={`${item.title}图片加载失败`}>
                                                            <ImageOff className="size-5" aria-hidden="true" />
                                                            <span>图片加载失败</span>
                                                            <button
                                                                type="button"
                                                                title="重新加载"
                                                                aria-label="重新加载图片"
                                                                tabIndex={copyIndex === 0 ? 0 : -1}
                                                                onClick={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    void loadItemImage(item, true);
                                                                }}
                                                            >
                                                                <RotateCcw className="size-4" aria-hidden="true" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="drift-wall__image drift-wall__image--loading" aria-hidden="true" />
                                                    )}
                                                    <span className="drift-wall__overlay" aria-hidden="true" />
                                                    <span className="drift-wall__caption">{item.title}</span>
                                                </div>
                                            </div>
                                        );
                                    }),
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Maximize, Minus, Pipette, Plus, ScanSearch } from "lucide-react";
import { Tooltip } from "antd";

import { analyzedColorFromRgb } from "./color-engine";
import { analyzeLoadedColorImage, drawOriginalColorPreview, loadColorImage, renderColorPreview, type LoadedColorImage } from "./renderer";
import type { AnalyzedColor, ColorAlchemySource, ColorAnalysis, ColorSettings } from "./types";

type PreviewDimensions = {
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
};

export function ColorPreviewStage({ source, settings, forceOriginal, onAnalysis, onPickColor }: { source: ColorAlchemySource; settings: ColorSettings; forceOriginal: boolean; onAnalysis: (analysis: ColorAnalysis) => void; onPickColor: (color: AnalyzedColor) => void }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const originalCanvasRef = useRef<HTMLCanvasElement>(null);
    const adjustedCanvasRef = useRef<HTMLCanvasElement>(null);
    const loadedRef = useRef<LoadedColorImage | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
    const [dimensions, setDimensions] = useState<PreviewDimensions | null>(null);
    const [compare, setCompare] = useState(58);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [loading, setLoading] = useState(true);
    const [rendering, setRendering] = useState(false);
    const [error, setError] = useState("");
    const [eyedropperActive, setEyedropperActive] = useState(false);
    const pointerRef = useRef<{ mode: "compare" | "pan"; pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);

    useEffect(() => {
        const element = stageRef.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => setContainerSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!eyedropperActive) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setEyedropperActive(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [eyedropperActive]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        setDimensions(null);
        originalCanvasRef.current?.getContext("2d")?.clearRect(0, 0, originalCanvasRef.current.width, originalCanvasRef.current.height);
        adjustedCanvasRef.current?.getContext("2d")?.clearRect(0, 0, adjustedCanvasRef.current.width, adjustedCanvasRef.current.height);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setEyedropperActive(false);
        loadedRef.current?.dispose();
        loadedRef.current = null;
        void loadColorImage(source)
            .then(async (loaded) => {
                if (cancelled) return loaded.dispose();
                loadedRef.current = loaded;
                const originalCanvas = originalCanvasRef.current;
                const adjustedCanvas = adjustedCanvasRef.current;
                if (!originalCanvas || !adjustedCanvas) return;
                const preview = drawOriginalColorPreview(loaded, originalCanvas);
                await renderColorPreview(loaded, adjustedCanvas, settings);
                if (cancelled) return;
                setDimensions({ ...preview, naturalWidth: loaded.width, naturalHeight: loaded.height });
                onAnalysis(analyzeLoadedColorImage(loaded));
                setLoading(false);
            })
            .catch((reason) => {
                if (cancelled) return;
                setLoading(false);
                setError(reason instanceof Error ? reason.message : "图片无法载入");
            });
        return () => {
            cancelled = true;
            loadedRef.current?.dispose();
            loadedRef.current = null;
        };
    }, [source.key, source.storageKey, source.url]);

    useEffect(() => {
        const loaded = loadedRef.current;
        const canvas = adjustedCanvasRef.current;
        if (!loaded || !canvas || loading) return;
        setRendering(true);
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void renderColorPreview(loaded, canvas, settings)
                .then(() => {
                    if (!cancelled) setError("");
                })
                .catch((reason) => {
                    if (!cancelled) setError(reason instanceof Error ? reason.message : "调色预览失败");
                })
                .finally(() => {
                    if (!cancelled) setRendering(false);
                });
        }, 36);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [settings, loading]);

    const fit = useMemo(() => {
        if (!dimensions) return { width: 1, height: 1 };
        const availableWidth = Math.max(120, containerSize.width - 88);
        const availableHeight = Math.max(120, containerSize.height - 92);
        const scale = Math.min(availableWidth / dimensions.width, availableHeight / dimensions.height);
        return { width: Math.max(1, dimensions.width * scale), height: Math.max(1, dimensions.height * scale) };
    }, [containerSize, dimensions]);

    const setZoomAroundCenter = useCallback((next: number) => {
        setZoom(Math.min(8, Math.max(0.25, next)));
        if (next <= 1) setPan({ x: 0, y: 0 });
    }, []);

    const showAtOneHundredPercent = () => {
        if (!dimensions || !fit.width) return;
        setZoomAroundCenter(Math.min(8, dimensions.naturalWidth / fit.width));
    };

    const updateCompare = (clientX: number) => {
        const frame = stageRef.current?.querySelector<HTMLElement>("[data-color-preview-frame]");
        if (!frame) return;
        const rect = frame.getBoundingClientRect();
        setCompare(Math.min(100, Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * 100)));
    };

    const pickColor = (clientX: number, clientY: number) => {
        const frame = stageRef.current?.querySelector<HTMLElement>("[data-color-preview-frame]");
        if (!frame || !dimensions) return;
        const rect = frame.getBoundingClientRect();
        const localX = clientX - rect.left;
        const localY = clientY - rect.top;
        if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return;
        const x = Math.min(dimensions.width - 1, Math.max(0, Math.floor((localX / Math.max(1, rect.width)) * dimensions.width)));
        const y = Math.min(dimensions.height - 1, Math.max(0, Math.floor((localY / Math.max(1, rect.height)) * dimensions.height)));
        const inAdjustedPreview = !forceOriginal && localX <= rect.width * (compare / 100);
        const canvas = inAdjustedPreview ? adjustedCanvasRef.current : originalCanvasRef.current;
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        const pixel = context.getImageData(x, y, 1, 1).data;
        onPickColor(analyzedColorFromRgb([pixel[0], pixel[1], pixel[2]]));
        setEyedropperActive(false);
    };

    const handlePointerMove = (event: React.PointerEvent) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        if (pointer.mode === "compare") updateCompare(event.clientX);
        else setPan({ x: pointer.panX + event.clientX - pointer.startX, y: pointer.panY + event.clientY - pointer.startY });
    };

    const stopPointer = (event: React.PointerEvent) => {
        if (pointerRef.current?.pointerId !== event.pointerId) return;
        pointerRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    };

    return (
        <div
            ref={stageRef}
            className="relative h-full min-h-0 overflow-hidden bg-[#0e1012]"
            onPointerMove={handlePointerMove}
            onPointerUp={stopPointer}
            onPointerCancel={stopPointer}
            onWheel={(event) => {
                event.preventDefault();
                setZoomAroundCenter(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
            }}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-35"
                style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)", backgroundSize: "32px 32px" }}
            />

            <div className="absolute inset-0 flex items-center justify-center px-10 py-10">
                <div
                    data-color-preview-frame
                    className="relative shrink-0 overflow-hidden bg-black shadow-[0_26px_90px_rgba(0,0,0,.48)]"
                    style={{ width: fit.width, height: fit.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center", cursor: eyedropperActive ? "crosshair" : zoom > 1 ? "grab" : "default" }}
                    onPointerDown={(event) => {
                        if (eyedropperActive) {
                            event.preventDefault();
                            event.stopPropagation();
                            pickColor(event.clientX, event.clientY);
                            return;
                        }
                        if (zoom <= 1 || (event.target as HTMLElement).closest("[data-compare-handle]")) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        pointerRef.current = { mode: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                    }}
                >
                    <canvas ref={originalCanvasRef} className="absolute inset-0 h-full w-full" aria-label="原图" />
                    <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: forceOriginal ? 0 : `${compare}%` }}>
                        <canvas ref={adjustedCanvasRef} className="absolute inset-0 h-full max-w-none" style={{ width: fit.width, height: fit.height }} aria-label="调色结果" />
                    </div>
                    {!forceOriginal ? (
                        <button
                            type="button"
                            data-compare-handle
                            className="absolute inset-y-0 z-10 w-8 -translate-x-1/2 cursor-ew-resize touch-none"
                            style={{ left: `${compare}%` }}
                            aria-label="拖动查看调色前后对比"
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                event.currentTarget.setPointerCapture(event.pointerId);
                                pointerRef.current = { mode: "compare", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                                updateCompare(event.clientX);
                            }}
                        >
                            <span className="absolute inset-y-0 left-1/2 w-px bg-white/90 shadow-[0_0_16px_rgba(255,255,255,.7)]" />
                            <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-black/55 text-[9px] text-white backdrop-blur-md">◀▶</span>
                        </button>
                    ) : null}
                    {forceOriginal ? (
                        <span className="absolute left-3 top-3 rounded bg-black/45 px-2 py-1 text-[10px] font-medium tracking-[0.14em] text-white/80 backdrop-blur-md">ORIGINAL</span>
                    ) : (
                        <>
                            <span className="absolute left-3 top-3 rounded bg-black/45 px-2 py-1 text-[10px] font-medium tracking-[0.14em] text-white/80 backdrop-blur-md">AFTER</span>
                            <span className="absolute right-3 top-3 rounded bg-black/45 px-2 py-1 text-[10px] font-medium tracking-[0.14em] text-white/80 backdrop-blur-md">BEFORE</span>
                        </>
                    )}
                </div>
            </div>

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-black/45 p-1 text-white/80 backdrop-blur-xl">
                <PreviewButton title={eyedropperActive ? "取消吸色" : "吸取画面颜色"} icon={<Pipette className="size-4" />} active={eyedropperActive} onClick={() => setEyedropperActive((value) => !value)} />
                <span className="mx-1 h-4 w-px bg-white/10" />
                <PreviewButton title="缩小" icon={<Minus className="size-4" />} onClick={() => setZoomAroundCenter(zoom / 1.2)} />
                <span className="min-w-14 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
                <PreviewButton title="放大" icon={<Plus className="size-4" />} onClick={() => setZoomAroundCenter(zoom * 1.2)} />
                <span className="mx-1 h-4 w-px bg-white/10" />
                <PreviewButton title="适应窗口" icon={<Maximize className="size-4" />} onClick={() => setZoomAroundCenter(1)} />
                <PreviewButton title="100% 查看" icon={<ScanSearch className="size-4" />} onClick={showAtOneHundredPercent} />
            </div>

            {loading ? (
                <div className="absolute inset-0 grid place-items-center bg-[#0e1012]/80 text-white/70 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin" /> 正在展开色彩空间
                    </div>
                </div>
            ) : null}
            {rendering && !loading ? (
                <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded bg-black/40 px-2 py-1 text-[11px] text-white/60 backdrop-blur-md">
                    <LoaderCircle className="size-3 animate-spin" /> 实时演色
                </div>
            ) : null}
            {error ? <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-red-300/20 bg-red-950/70 px-3 py-2 text-xs text-red-100 backdrop-blur-md">{error}</div> : null}
        </div>
    );
}

function PreviewButton({ title, icon, onClick, active = false }: { title: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
    return (
        <Tooltip title={title}>
            <button type="button" className={`grid size-8 place-items-center rounded transition hover:bg-white/10 hover:text-white ${active ? "bg-[#d7b46a] text-[#18140d] hover:bg-[#e5c783] hover:text-[#18140d]" : ""}`} onClick={onClick} aria-label={title}>
                {icon}
            </button>
        </Tooltip>
    );
}

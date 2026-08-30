import React, { useEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { shouldDeselectAfterCanvasPan, shouldStartCanvasPan } from "@/lib/canvas/canvas-interaction";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    transparentBackground?: boolean;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
    overlay?: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, backgroundMode = "lines", transparentBackground = false, onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children, overlay }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    const scaleRef = useRef(viewport.k);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchStateRef = useRef<{
        initialDistance: number;
        initialScale: number;
        worldCenterX: number;
        worldCenterY: number;
    } | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useEffect(() => {
        scaleRef.current = viewport.k;
    }, [viewport.k]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null) => {
            const element = target instanceof Element ? target : null;
            return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || Boolean(element?.closest("[contenteditable='true']"));
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || isEditableTarget(event.target)) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (!isEditableTarget(event.target)) event.preventDefault();
            setIsSpacePressed(false);
        };
        const handleBlur = () => {
            setIsSpacePressed(false);
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(viewport.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - viewport.x) / viewport.k;
        const worldY = (mouseY - viewport.y) / viewport.k;

        onViewportChange({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === "touch") {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (touchPointsRef.current.size >= 2) {
                const points = [...touchPointsRef.current.values()];
                const first = points[0];
                const second = points[1];
                const centerX = (first.x + second.x) / 2;
                const centerY = (first.y + second.y) / 2;
                const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                    pinchStateRef.current = {
                        initialDistance: distance,
                        initialScale: viewport.k,
                        worldCenterX: (centerX - rect.left - viewport.x) / viewport.k,
                        worldCenterY: (centerY - rect.top - viewport.y) / viewport.k,
                    };
                    panState.current.isPanning = false;
                    setIsPanning(true);
                }
                return;
            }
        }
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.button === 0 && (event.ctrlKey || event.metaKey) && !isSpacePressed && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (shouldStartCanvasPan({ button: event.button, isBackgroundClick, isSpacePressed })) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewport.x,
                initialY: viewport.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerType === "touch" && touchPointsRef.current.has(event.pointerId)) {
                touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const pinch = pinchStateRef.current;
                if (pinch && touchPointsRef.current.size >= 2) {
                    const points = [...touchPointsRef.current.values()];
                    const first = points[0];
                    const second = points[1];
                    const centerX = (first.x + second.x) / 2;
                    const centerY = (first.y + second.y) / 2;
                    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
                    const newScale = Math.min(Math.max(pinch.initialScale * (distance / pinch.initialDistance), 0.05), 5);
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                        nextViewportRef.current = {
                            x: centerX - rect.left - pinch.worldCenterX * newScale,
                            y: centerY - rect.top - pinch.worldCenterY * newScale,
                            k: newScale,
                        };
                        if (frameRef.current) return;
                        frameRef.current = requestAnimationFrame(() => {
                            frameRef.current = null;
                            if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
                        });
                    }
                    return;
                }
            }
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
            });
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerType === "touch") {
                touchPointsRef.current.delete(event.pointerId);
                if (touchPointsRef.current.size < 2) {
                    pinchStateRef.current = null;
                    if (!panState.current.isPanning) setIsPanning(false);
                }
            }
            if (!panState.current.isPanning) return;

            if (shouldDeselectAfterCanvasPan(panState.current)) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            touchPointsRef.current.clear();
            pinchStateRef.current = null;
            document.body.style.cursor = "";
        };
    }, [onCanvasDeselect, onViewportChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // 阻止画布滚动导致页面滚动;但浮层(创建菜单/弹窗等)内允许原生滚动
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            className="relative z-10 h-full w-full cursor-grab select-none overflow-hidden"
            style={{ background: transparentBackground ? "transparent" : theme.canvas.background, cursor: isPanning ? "grabbing" : undefined, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} emphasized={transparentBackground} />
            <div
                data-canvas-world="true"
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
            {overlay ? (
                <div data-canvas-overlay="true" data-canvas-no-zoom="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
                    {overlay}
                </div>
            ) : null}
        </div>
    );
}

function CanvasGrid({ viewport, mode, emphasized }: { viewport: ViewportTransform; mode: CanvasBackgroundMode; emphasized: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="pointer-events-none absolute inset-0"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
                opacity: emphasized ? 0.58 : 0.4,
            }}
        />
    );
}

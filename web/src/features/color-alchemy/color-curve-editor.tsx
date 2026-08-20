import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { RotateCcw } from "lucide-react";

import { buildColorCurveLut, sampleColorCurveLut } from "./color-curve";
import { createDefaultColorCurve } from "./settings";
import type { ColorCurve } from "./types";

const MAX_CURVE_POINTS = 12;
const MIN_POINT_GAP = 0.015;
const KEYBOARD_STEP = 1 / 255;
type CurveBounds = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

export function ColorCurveEditor({ curve, color, onChange, onCommit }: { curve: ColorCurve; color: string; onChange: (curve: ColorCurve) => void; onCommit: () => void }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const curveLineRef = useRef<SVGPolylineElement>(null);
    const curvePointRefs = useRef<Array<SVGCircleElement | null>>([]);
    const inputValueRef = useRef<HTMLSpanElement>(null);
    const outputValueRef = useRef<HTMLSpanElement>(null);
    const frameRef = useRef<number | null>(null);
    const dragFrameRef = useRef<number | null>(null);
    const latestPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const pendingCurveRef = useRef<ColorCurve | null>(null);
    const workingCurveRef = useRef(curve);
    const draggingIndexRef = useRef<number | null>(null);
    const selectedIndexRef = useRef(0);
    const dragBoundsRef = useRef<CurveBounds | null>(null);
    const onChangeRef = useRef(onChange);
    const [workingCurve, setWorkingCurve] = useState(curve);
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (draggingIndexRef.current !== null) return;
        workingCurveRef.current = curve;
        setWorkingCurve(curve);
        setSelectedIndex((index) => {
            const nextIndex = Math.min(index, curve.length - 1);
            selectedIndexRef.current = nextIndex;
            return nextIndex;
        });
    }, [curve]);

    useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
        },
        [],
    );

    const renderCurveVisual = (next: ColorCurve) => {
        const lut = buildColorCurveLut(next);
        if (curveLineRef.current) curveLineRef.current.setAttribute("points", linePointsForCurve(lut));
        next.forEach((point, index) => {
            renderPointVisual(index, point);
        });
        const selectedPoint = next[Math.min(selectedIndexRef.current, next.length - 1)] || next[0];
        if (selectedPoint) renderPointValues(selectedPoint);
    };

    const renderPointVisual = (index: number, point: ColorCurve[number]) => {
        const element = curvePointRefs.current[index];
        if (!element) return;
        element.setAttribute("cx", String(point.x * 100));
        element.setAttribute("cy", String((1 - point.y) * 100));
    };

    const renderPointValues = (point: ColorCurve[number]) => {
        if (inputValueRef.current) inputValueRef.current.textContent = `输入 ${Math.round(point.x * 255)}`;
        if (outputValueRef.current) outputValueRef.current.textContent = `输出 ${Math.round(point.y * 255)}`;
    };

    const publishCurve = (next: ColorCurve) => {
        workingCurveRef.current = next;
        pendingCurveRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingCurveRef.current;
            pendingCurveRef.current = null;
            if (!pending) return;
            renderCurveVisual(pending);
        });
    };

    const flushCurve = () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        const pending = pendingCurveRef.current;
        pendingCurveRef.current = null;
        if (!pending) return;
        renderCurveVisual(pending);
    };

    const commitCurve = () => {
        flushCurve();
        const next = workingCurveRef.current;
        setWorkingCurve(next);
        onChangeRef.current(next);
        onCommit();
    };

    const beginDrag = (index: number, pointerId: number) => {
        draggingIndexRef.current = index;
        selectedIndexRef.current = index;
        workingCurveRef.current = workingCurveRef.current.map((point) => ({ ...point }));
        latestPointerRef.current = null;
        setSelectedIndex(index);
        dragBoundsRef.current = svgRef.current?.getBoundingClientRect() || null;
        svgRef.current?.setPointerCapture(pointerId);
    };

    const applyLatestPointer = () => {
        const pointer = latestPointerRef.current;
        const index = draggingIndexRef.current;
        if (!pointer || index === null) return;
        const point = pointerPosition(dragBoundsRef.current, pointer.clientX, pointer.clientY);
        updatePoint(index, point.x, point.y);
        latestPointerRef.current = null;
    };

    const scheduleDragFrame = () => {
        if (dragFrameRef.current !== null) return;
        dragFrameRef.current = requestAnimationFrame(() => {
            dragFrameRef.current = null;
            applyLatestPointer();
            if (latestPointerRef.current && draggingIndexRef.current !== null) scheduleDragFrame();
        });
    };

    const endDrag = (pointerId: number, clientX: number, clientY: number) => {
        if (draggingIndexRef.current === null) return;
        latestPointerRef.current = { clientX, clientY };
        if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
        applyLatestPointer();
        draggingIndexRef.current = null;
        dragBoundsRef.current = null;
        if (svgRef.current?.hasPointerCapture(pointerId)) svgRef.current.releasePointerCapture(pointerId);
        commitCurve();
    };

    const updatePoint = (index: number, x: number, y: number) => {
        const current = workingCurveRef.current;
        const previous = current[index - 1];
        const next = current[index + 1];
        const point = current[index];
        const lockedX = index === 0 ? 0 : index === current.length - 1 ? 1 : clamp(x, previous.x + MIN_POINT_GAP, next.x - MIN_POINT_GAP);
        const nextX = round(lockedX);
        const nextY = round(clamp(y, 0, 1));
        if (point.x === nextX && point.y === nextY) return;
        if (draggingIndexRef.current !== null) {
            point.x = nextX;
            point.y = nextY;
            renderPointVisual(index, point);
            if (selectedIndexRef.current === index) renderPointValues(point);
            publishCurve(current);
            return;
        }
        const updated = current.map((item, itemIndex) => (itemIndex === index ? { x: round(lockedX), y: round(clamp(y, 0, 1)) } : item));
        publishCurve(updated);
    };

    const selectedPoint = workingCurve[Math.min(selectedIndex, workingCurve.length - 1)] || workingCurve[0];
    const lut = buildColorCurveLut(workingCurve);
    const linePoints = linePointsForCurve(lut);

    return (
        <div className="space-y-2">
            <div className="relative aspect-square w-full overflow-hidden rounded-md border border-white/10 bg-[#0b0c0d]">
                <svg
                    ref={svgRef}
                    viewBox="0 0 100 100"
                    className="size-full touch-none select-none"
                    onPointerDown={(event) => {
                        if (event.button !== 0 || workingCurve.length >= MAX_CURVE_POINTS) return;
                        const point = pointerPosition(svgRef.current?.getBoundingClientRect() || null, event.clientX, event.clientY);
                        const inserted = { x: round(clamp(point.x, MIN_POINT_GAP, 1 - MIN_POINT_GAP)), y: round(clamp(point.y, 0, 1)) };
                        const next = [...workingCurveRef.current, inserted].sort((left, right) => left.x - right.x);
                        const index = next.indexOf(inserted);
                        workingCurveRef.current = next;
                        setWorkingCurve(next);
                        onChangeRef.current(next);
                        beginDrag(index, event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const index = draggingIndexRef.current;
                        if (index === null) return;
                        latestPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
                        scheduleDragFrame();
                    }}
                    onPointerUp={(event) => endDrag(event.pointerId, event.clientX, event.clientY)}
                    onPointerCancel={(event) => endDrag(event.pointerId, event.clientX, event.clientY)}
                >
                    <rect width="100" height="100" fill="transparent" />
                    {[25, 50, 75].map((position) => (
                        <g key={position} stroke="rgba(255,255,255,.075)" strokeWidth="0.55">
                            <line x1={position} y1="0" x2={position} y2="100" />
                            <line x1="0" y1={position} x2="100" y2={position} />
                        </g>
                    ))}
                    <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,.15)" strokeWidth="0.7" strokeDasharray="2 2" />
                    <polyline ref={curveLineRef} points={linePoints} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
                    {workingCurve.map((point, index) => (
                        <circle
                            ref={(element) => {
                                curvePointRefs.current[index] = element;
                            }}
                            key={index}
                            cx={point.x * 100}
                            cy={(1 - point.y) * 100}
                            r={selectedIndex === index ? 3.2 : 2.7}
                            fill={selectedIndex === index ? color : "#151719"}
                            stroke={selectedIndex === index ? "#fff" : color}
                            strokeWidth="1.1"
                            vectorEffect="non-scaling-stroke"
                            className="cursor-grab outline-none focus:stroke-white active:cursor-grabbing"
                            role="slider"
                            tabIndex={0}
                            aria-label={`曲线控制点 ${index + 1}`}
                            aria-valuetext={`输入 ${Math.round(point.x * 255)}，输出 ${Math.round(point.y * 255)}`}
                            onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.stopPropagation();
                                beginDrag(index, event.pointerId);
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                if (index === 0 || index === workingCurve.length - 1) return;
                                draggingIndexRef.current = null;
                                const next = workingCurveRef.current.filter((_, itemIndex) => itemIndex !== index);
                                const nextIndex = Math.max(0, index - 1);
                                workingCurveRef.current = next;
                                setWorkingCurve(next);
                                selectedIndexRef.current = nextIndex;
                                setSelectedIndex(nextIndex);
                                onChangeRef.current(next);
                                onCommit();
                            }}
                            onFocus={() => {
                                selectedIndexRef.current = index;
                                setSelectedIndex(index);
                            }}
                            onKeyDown={(event) => {
                                const multiplier = event.shiftKey ? 5 : 1;
                                if (event.key === "Delete" || event.key === "Backspace") {
                                    if (index === 0 || index === workingCurve.length - 1) return;
                                    event.preventDefault();
                                    const next = workingCurveRef.current.filter((_, itemIndex) => itemIndex !== index);
                                    const nextIndex = Math.max(0, index - 1);
                                    workingCurveRef.current = next;
                                    setWorkingCurve(next);
                                    selectedIndexRef.current = nextIndex;
                                    setSelectedIndex(nextIndex);
                                    onChangeRef.current(next);
                                    onCommit();
                                    return;
                                }
                                const movement = KEYBOARD_STEP * multiplier;
                                const directions: Record<string, [number, number]> = {
                                    ArrowLeft: [-movement, 0],
                                    ArrowRight: [movement, 0],
                                    ArrowUp: [0, movement],
                                    ArrowDown: [0, -movement],
                                };
                                const direction = directions[event.key];
                                if (!direction) return;
                                event.preventDefault();
                                const currentPoint = workingCurveRef.current[index];
                                updatePoint(index, currentPoint.x + direction[0], currentPoint.y + direction[1]);
                                flushCurve();
                                const next = workingCurveRef.current;
                                setWorkingCurve(next);
                                onChangeRef.current(next);
                            }}
                            onKeyUp={(event) => {
                                if (event.key.startsWith("Arrow")) onCommit();
                            }}
                        />
                    ))}
                </svg>
            </div>
            <div className="flex h-7 items-center justify-between text-[10px] tabular-nums text-white/45">
                <span ref={inputValueRef}>输入 {Math.round(selectedPoint.x * 255)}</span>
                <span ref={outputValueRef}>输出 {Math.round(selectedPoint.y * 255)}</span>
                <Tooltip title="重置当前通道曲线">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded text-white/45 transition hover:bg-white/8 hover:text-white"
                        aria-label="重置当前通道曲线"
                        onClick={() => {
                            const next = createDefaultColorCurve();
                            workingCurveRef.current = next;
                            setWorkingCurve(next);
                            selectedIndexRef.current = 0;
                            setSelectedIndex(0);
                            onChangeRef.current(next);
                            onCommit();
                        }}
                    >
                        <RotateCcw className="size-3.5" />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

function linePointsForCurve(lut: Float32Array) {
    return Array.from({ length: 65 }, (_, index) => {
        const x = index / 64;
        return `${x * 100},${100 - sampleColorCurveLut(lut, x) * 100}`;
    }).join(" ");
}

function pointerPosition(bounds: CurveBounds | null, clientX: number, clientY: number) {
    if (!bounds?.width || !bounds.height) return { x: 0.5, y: 0.5 };
    return {
        x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
        y: 1 - clamp((clientY - bounds.top) / bounds.height, 0, 1),
    };
}

function round(value: number) {
    return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

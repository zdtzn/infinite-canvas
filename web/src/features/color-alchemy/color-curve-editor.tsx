import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { RotateCcw } from "lucide-react";

import { buildColorCurveLut, sampleColorCurveLut } from "./color-curve";
import { createDefaultColorCurve } from "./settings";
import type { ColorCurve } from "./types";

const MAX_CURVE_POINTS = 12;
const MIN_POINT_GAP = 0.015;
const KEYBOARD_STEP = 1 / 255;

export function ColorCurveEditor({ curve, color, onChange, onCommit }: { curve: ColorCurve; color: string; onChange: (curve: ColorCurve) => void; onCommit: () => void }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const frameRef = useRef<number | null>(null);
    const pendingCurveRef = useRef<ColorCurve | null>(null);
    const workingCurveRef = useRef(curve);
    const draggingIndexRef = useRef<number | null>(null);
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
        setSelectedIndex((index) => Math.min(index, curve.length - 1));
    }, [curve]);

    useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    const publishCurve = (next: ColorCurve) => {
        workingCurveRef.current = next;
        pendingCurveRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingCurveRef.current;
            pendingCurveRef.current = null;
            if (!pending) return;
            setWorkingCurve(pending);
        });
    };

    const flushCurve = () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        const pending = pendingCurveRef.current;
        pendingCurveRef.current = null;
        if (!pending) return;
        setWorkingCurve(pending);
    };

    const commitCurve = () => {
        flushCurve();
        onChangeRef.current(workingCurveRef.current);
        onCommit();
    };

    const beginDrag = (index: number, pointerId: number) => {
        draggingIndexRef.current = index;
        setSelectedIndex(index);
        svgRef.current?.setPointerCapture(pointerId);
    };

    const endDrag = (pointerId: number) => {
        if (draggingIndexRef.current === null) return;
        draggingIndexRef.current = null;
        if (svgRef.current?.hasPointerCapture(pointerId)) svgRef.current.releasePointerCapture(pointerId);
        commitCurve();
    };

    const updatePoint = (index: number, x: number, y: number) => {
        const current = workingCurveRef.current;
        const previous = current[index - 1];
        const next = current[index + 1];
        const point = current[index];
        const lockedX = index === 0 ? 0 : index === current.length - 1 ? 1 : clamp(x, previous.x + MIN_POINT_GAP, next.x - MIN_POINT_GAP);
        const updated = current.map((item, itemIndex) => (itemIndex === index ? { x: round(lockedX), y: round(clamp(y, 0, 1)) } : item));
        if (point.x === updated[index].x && point.y === updated[index].y) return;
        publishCurve(updated);
    };

    const selectedPoint = workingCurve[Math.min(selectedIndex, workingCurve.length - 1)] || workingCurve[0];
    const lut = buildColorCurveLut(workingCurve);
    const linePoints = Array.from({ length: 65 }, (_, index) => {
        const x = index / 64;
        return `${x * 100},${100 - sampleColorCurveLut(lut, x) * 100}`;
    }).join(" ");

    return (
        <div className="space-y-2">
            <div className="relative aspect-square w-full overflow-hidden rounded-md border border-white/10 bg-[#0b0c0d]">
                <svg
                    ref={svgRef}
                    viewBox="0 0 100 100"
                    className="size-full touch-none select-none"
                    onPointerDown={(event) => {
                        if (event.button !== 0 || workingCurve.length >= MAX_CURVE_POINTS) return;
                        const point = pointerPosition(svgRef.current, event.clientX, event.clientY);
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
                        const point = pointerPosition(svgRef.current, event.clientX, event.clientY);
                        updatePoint(index, point.x, point.y);
                    }}
                    onPointerUp={(event) => endDrag(event.pointerId)}
                    onPointerCancel={(event) => endDrag(event.pointerId)}
                >
                    <rect width="100" height="100" fill="transparent" />
                    {[25, 50, 75].map((position) => (
                        <g key={position} stroke="rgba(255,255,255,.075)" strokeWidth="0.55">
                            <line x1={position} y1="0" x2={position} y2="100" />
                            <line x1="0" y1={position} x2="100" y2={position} />
                        </g>
                    ))}
                    <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,.15)" strokeWidth="0.7" strokeDasharray="2 2" />
                    <polyline points={linePoints} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
                    {workingCurve.map((point, index) => (
                        <circle
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
                                workingCurveRef.current = next;
                                setWorkingCurve(next);
                                setSelectedIndex(Math.max(0, index - 1));
                                onChangeRef.current(next);
                                onCommit();
                            }}
                            onFocus={() => setSelectedIndex(index)}
                            onKeyDown={(event) => {
                                const multiplier = event.shiftKey ? 5 : 1;
                                if (event.key === "Delete" || event.key === "Backspace") {
                                    if (index === 0 || index === workingCurve.length - 1) return;
                                    event.preventDefault();
                                    const next = workingCurveRef.current.filter((_, itemIndex) => itemIndex !== index);
                                    workingCurveRef.current = next;
                                    setWorkingCurve(next);
                                    setSelectedIndex(Math.max(0, index - 1));
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
                                updatePoint(index, point.x + direction[0], point.y + direction[1]);
                                flushCurve();
                                onChangeRef.current(workingCurveRef.current);
                            }}
                            onKeyUp={(event) => {
                                if (event.key.startsWith("Arrow")) onCommit();
                            }}
                        />
                    ))}
                </svg>
            </div>
            <div className="flex h-7 items-center justify-between text-[10px] tabular-nums text-white/45">
                <span>输入 {Math.round(selectedPoint.x * 255)}</span>
                <span>输出 {Math.round(selectedPoint.y * 255)}</span>
                <Tooltip title="重置当前通道曲线">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded text-white/45 transition hover:bg-white/8 hover:text-white"
                        aria-label="重置当前通道曲线"
                        onClick={() => {
                            const next = createDefaultColorCurve();
                            workingCurveRef.current = next;
                            setWorkingCurve(next);
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

function pointerPosition(svg: SVGSVGElement | null, clientX: number, clientY: number) {
    const bounds = svg?.getBoundingClientRect();
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

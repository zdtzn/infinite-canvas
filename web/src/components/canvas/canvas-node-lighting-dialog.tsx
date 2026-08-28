import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Sparkles, Sun } from "lucide-react";

export type CanvasLightingMode = "front" | "perspective";
export type CanvasLightingDirection = "front" | "left" | "top" | "back" | "right" | "bottom";

export type CanvasImageLightingParams = {
    mode: CanvasLightingMode;
    direction: CanvasLightingDirection;
    lightPosition: { x: number; y: number };
    brightness: number;
    temperature: number;
};

export const defaultCanvasLightingParams: CanvasImageLightingParams = {
    mode: "perspective",
    direction: "left",
    lightPosition: { x: -0.88, y: 0 },
    brightness: 68,
    temperature: 5000,
};

const directionOptions: Array<{ value: CanvasLightingDirection; label: string; icon: React.ReactNode; position: { x: number; y: number } }> = [
    { value: "front", label: "前方顺光", icon: <Sun className="size-4" />, position: { x: 0, y: 0 } },
    { value: "left", label: "左侧光", icon: <ArrowLeft className="size-4" />, position: { x: -0.88, y: 0 } },
    { value: "top", label: "顶光", icon: <ArrowUp className="size-4" />, position: { x: 0, y: -0.88 } },
    { value: "back", label: "后方逆光", icon: <Sun className="size-4" />, position: { x: 0.68, y: -0.58 } },
    { value: "right", label: "右侧光", icon: <ArrowRight className="size-4" />, position: { x: 0.88, y: 0 } },
    { value: "bottom", label: "底光", icon: <ArrowDown className="size-4" />, position: { x: 0, y: 0.88 } },
];

export function CanvasNodeLightingDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageLightingParams) => void }) {
    const [params, setParams] = useState(defaultCanvasLightingParams);

    useEffect(() => {
        if (open) setParams(defaultCanvasLightingParams);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageLightingParams>(key: Key, value: CanvasImageLightingParams[Key]) => setParams((current) => ({ ...current, [key]: value }));
    const preview = useMemo(() => lightingPreviewStyle(params), [params]);
    const activeDirection = directionOptions.find((item) => item.value === params.direction)?.label || "左侧光";

    const setLightPosition = (position: { x: number; y: number }) => {
        const normalized = clampLightPosition(position);
        setParams((current) => ({ ...current, direction: nearestLightingDirection(normalized), lightPosition: normalized }));
    };

    const updateLightFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const diameter = Math.min(rect.width, rect.height);
        setLightPosition({
            x: (event.clientX - (rect.left + rect.width / 2)) / (diameter * 0.46),
            y: (event.clientY - (rect.top + rect.height / 2)) / (diameter * 0.46),
        });
    };

    const handleLightPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateLightFromPointer(event);
    };

    const handleLightKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const offset = event.shiftKey ? 0.02 : 0.08;
        const delta = {
            ArrowLeft: { x: -offset, y: 0 },
            ArrowRight: { x: offset, y: 0 },
            ArrowUp: { x: 0, y: -offset },
            ArrowDown: { x: 0, y: offset },
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        setLightPosition({ x: params.lightPosition.x + delta.x, y: params.lightPosition.y + delta.y });
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={900} centered destroyOnHidden styles={{ body: { maxHeight: "calc(100vh - 96px)", overflowY: "auto" } }}>
            <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-9">
                    <div className="flex items-center gap-2">
                        <span className="grid size-9 place-items-center rounded-md bg-cyan-500/12 text-cyan-500">
                            <Sun className="size-5" />
                        </span>
                        <div>
                            <h2 className="text-xl font-semibold">AI 打光</h2>
                            <p className="mt-0.5 text-sm opacity-60">预览光线方向，基于原图生成新的光影版本</p>
                        </div>
                    </div>
                    <Segmented
                        value={params.mode}
                        options={[
                            { label: "正面", value: "front" },
                            { label: "透视", value: "perspective" },
                        ]}
                        onChange={(value) => update("mode", value as CanvasLightingMode)}
                    />
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(300px,0.92fr)_minmax(360px,1.08fr)]">
                    <div className="relative min-h-[390px] overflow-hidden rounded-lg border border-white/10 bg-[#0a0e14] p-5 text-white shadow-inner">
                        <div className="absolute inset-x-0 top-0 h-px bg-white/12" />
                        <div className="flex items-center justify-between text-xs text-white/55">
                            <span>{params.mode === "front" ? "正面布光" : "空间布光"}</span>
                            <span>{activeDirection}</span>
                        </div>

                        <div
                            className="relative mx-auto mt-5 grid aspect-square w-full max-w-[280px] touch-none select-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                            role="slider"
                            tabIndex={0}
                            aria-label="主光源位置"
                            aria-valuetext={`${activeDirection}，水平 ${Math.round(params.lightPosition.x * 100)}%，垂直 ${Math.round(params.lightPosition.y * 100)}%`}
                            title="拖动调整光源位置"
                            onPointerDown={handleLightPointerDown}
                            onPointerMove={(event) => {
                                if (event.buttons === 1 || event.currentTarget.hasPointerCapture(event.pointerId)) updateLightFromPointer(event);
                            }}
                            onPointerUp={(event) => {
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                            }}
                            onPointerCancel={(event) => {
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                            }}
                            onKeyDown={handleLightKeyDown}
                        >
                            <div className="absolute inset-[7%] rounded-full border border-white/[0.08] bg-[radial-gradient(circle_at_center,rgba(34,55,79,.2),rgba(4,8,13,.55)_68%,rgba(255,255,255,.04))] shadow-[inset_0_0_38px_rgba(0,0,0,.55)]" />
                            <div className="absolute inset-[11%] rounded-full border border-dashed border-white/[0.08]" />
                            <div className="absolute left-1/2 top-1/2 h-px -translate-y-1/2" style={preview.beam} />
                            <div className="absolute bottom-[15%] left-1/2 h-8 w-36 -translate-x-1/2 rounded-[50%] bg-black/70 blur-xl" style={preview.shadow} />
                            <div className="absolute grid size-44 place-items-center overflow-hidden rounded-full border border-white/[0.14]" style={preview.sphere}>
                                <img src={dataUrl} alt="" draggable={false} className="relative z-10 max-h-24 max-w-28 rounded object-contain opacity-65 shadow-2xl" style={preview.image} />
                                <div className="pointer-events-none absolute inset-0" style={preview.sphereLight} />
                                <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_-18px_-24px_42px_rgba(0,0,0,.6),inset_10px_8px_20px_rgba(255,255,255,.05)]" />
                            </div>
                            <div className="absolute size-[18px] cursor-grab rounded-full border-2 border-white bg-white shadow-[0_0_0_5px_rgba(255,255,255,.08)] active:cursor-grabbing" style={preview.source} />
                            <span className="absolute left-1/2 top-[5%] size-1 -translate-x-1/2 rounded-full bg-white/20" />
                            <span className="absolute right-[5%] top-1/2 size-1 -translate-y-1/2 rounded-full bg-white/20" />
                            <span className="absolute bottom-[5%] left-1/2 size-1 -translate-x-1/2 rounded-full bg-white/20" />
                            <span className="absolute left-[5%] top-1/2 size-1 -translate-y-1/2 rounded-full bg-white/20" />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <PreviewMetric label="亮度" value={`${params.brightness}%`} />
                            <PreviewMetric label="色温" value={`${params.temperature}K`} color={temperatureColor(params.temperature)} />
                        </div>
                    </div>

                    <div className="space-y-6 rounded-lg border p-5">
                        <LightingSlider label="亮度" value={params.brightness} min={10} max={100} step={1} suffix="%" onChange={(value) => update("brightness", value)} />
                        <LightingSlider label="色温" value={params.temperature} min={2000} max={8000} step={100} suffix="K" onChange={(value) => update("temperature", value)} trackColor={temperatureColor(params.temperature)} />

                        <div>
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-medium opacity-75">主光方向</span>
                                <span className="text-xs opacity-45">单主光源</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {directionOptions.map((item) => {
                                    const active = item.value === params.direction;
                                    return (
                                        <button
                                            key={item.value}
                                            type="button"
                                            className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm transition ${active ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300" : "border-black/10 hover:border-cyan-500/35 hover:bg-black/[0.025] dark:border-white/10 dark:hover:bg-white/[0.04]"}`}
                                            onClick={() => setParams((current) => ({ ...current, direction: item.value, lightPosition: item.position }))}
                                            aria-pressed={active}
                                        >
                                            {item.icon}
                                            <span>{item.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-md border border-cyan-500/15 bg-cyan-500/[0.045] px-3 py-2 text-xs leading-5 opacity-75">将严格保留主体、构图、文字和画面比例，仅重塑光线、阴影与空间层次。</div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <Button icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultCanvasLightingParams)}>
                        重置
                    </Button>
                    <Button type="primary" size="large" icon={<Sparkles className="size-4" />} onClick={() => onConfirm(params)}>
                        生成打光版本
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function LightingSlider({ label, value, min, max, step, suffix, trackColor, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; trackColor?: string; onChange: (value: number) => void }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-4">
                <span className="text-sm font-medium opacity-75">{label}</span>
                <span className="min-w-16 text-right text-sm font-semibold">
                    {value}
                    {suffix}
                </span>
            </div>
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} styles={trackColor ? { track: { background: trackColor } } : undefined} />
        </div>
    );
}

function PreviewMetric({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.045] px-3 py-2">
            <div className="text-[11px] text-white/45">{label}</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                {color ? <span className="size-2 rounded-full" style={{ background: color }} /> : null}
                {value}
            </div>
        </div>
    );
}

function lightingPreviewStyle(params: CanvasImageLightingParams) {
    const x = params.lightPosition.x;
    const y = params.lightPosition.y;
    const sourceLeft = 50 + x * 42;
    const sourceTop = 50 + y * 42;
    const highlightLeft = 50 + x * 31;
    const highlightTop = 50 + y * 31;
    const color = temperatureColor(params.temperature);
    const intensity = 0.24 + params.brightness / 145;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    const distance = Math.hypot(x, y);
    return {
        source: { left: `${sourceLeft}%`, top: `${sourceTop}%`, transform: "translate(-50%, -50%)", background: color, boxShadow: `0 0 24px 8px ${withAlpha(color, 0.34)}` },
        beam: {
            width: `${Math.max(0, distance * 42)}%`,
            transform: `rotate(${angle}deg)`,
            transformOrigin: "left center",
            background: `linear-gradient(90deg, ${withAlpha(color, 0.02)}, ${withAlpha(color, 0.4)})`,
            boxShadow: `0 0 10px ${withAlpha(color, 0.22)}`,
        },
        shadow: { transform: `translateX(calc(-50% - ${x * 14}px)) scaleX(${1 + Math.abs(x) * 0.18})`, opacity: 0.55 + Math.abs(y) * 0.2 },
        sphere: {
            background: "rgba(15, 23, 34, .88)",
            boxShadow: params.direction === "back" ? `0 0 34px ${withAlpha(color, 0.38)}, inset 0 -22px 36px rgba(0,0,0,.55)` : `inset 0 -24px 38px rgba(0,0,0,.62), 0 18px 34px rgba(0,0,0,.42)`,
            transform: params.mode === "perspective" ? "perspective(420px) rotateY(-10deg) rotateX(5deg)" : undefined,
        },
        sphereLight: { background: `radial-gradient(circle at ${highlightLeft}% ${highlightTop}%, ${withAlpha(color, Math.min(0.93, intensity))} 0%, ${withAlpha(color, 0.22)} 24%, rgba(17,25,36,.18) 48%, rgba(5,9,14,.72) 82%)` },
        image: { transform: params.mode === "perspective" ? `perspective(260px) rotateY(${x * -12}deg) rotateX(${y * 8}deg)` : undefined, filter: `brightness(${0.58 + params.brightness / 165}) saturate(.9)` },
    };
}

function clampLightPosition(position: { x: number; y: number }) {
    const distance = Math.hypot(position.x, position.y);
    const scale = distance > 1 ? 1 / distance : 1;
    return { x: roundPosition(position.x * scale), y: roundPosition(position.y * scale) };
}

function nearestLightingDirection(position: { x: number; y: number }) {
    return directionOptions.reduce(
        (nearest, option) => {
            const distance = (option.position.x - position.x) ** 2 + (option.position.y - position.y) ** 2;
            return distance < nearest.distance ? { value: option.value, distance } : nearest;
        },
        { value: "front" as CanvasLightingDirection, distance: Number.POSITIVE_INFINITY },
    ).value;
}

function roundPosition(value: number) {
    return Math.round(value * 1000) / 1000;
}

function temperatureColor(kelvin: number) {
    const ratio = Math.max(0, Math.min(1, (kelvin - 2000) / 6000));
    const red = Math.round(255 - ratio * 74);
    const green = Math.round(150 + ratio * 70);
    const blue = Math.round(76 + ratio * 179);
    return `rgb(${red}, ${green}, ${blue})`;
}

function withAlpha(rgb: string, alpha: number) {
    return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Sparkles, Sun } from "lucide-react";

export type CanvasLightingMode = "front" | "perspective";
export type CanvasLightingDirection = "front" | "left" | "top" | "back" | "right" | "bottom";

export type CanvasImageLightingParams = {
    mode: CanvasLightingMode;
    direction: CanvasLightingDirection;
    brightness: number;
    temperature: number;
};

export const defaultCanvasLightingParams: CanvasImageLightingParams = {
    mode: "perspective",
    direction: "left",
    brightness: 68,
    temperature: 5000,
};

const directionOptions: Array<{ value: CanvasLightingDirection; label: string; icon: React.ReactNode }> = [
    { value: "front", label: "前方顺光", icon: <Sun className="size-4" /> },
    { value: "left", label: "左侧光", icon: <ArrowLeft className="size-4" /> },
    { value: "top", label: "顶光", icon: <ArrowUp className="size-4" /> },
    { value: "back", label: "后方逆光", icon: <Sun className="size-4" /> },
    { value: "right", label: "右侧光", icon: <ArrowRight className="size-4" /> },
    { value: "bottom", label: "底光", icon: <ArrowDown className="size-4" /> },
];

export function CanvasNodeLightingDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageLightingParams) => void }) {
    const [params, setParams] = useState(defaultCanvasLightingParams);

    useEffect(() => {
        if (open) setParams(defaultCanvasLightingParams);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageLightingParams>(key: Key, value: CanvasImageLightingParams[Key]) => setParams((current) => ({ ...current, [key]: value }));
    const preview = useMemo(() => lightingPreviewStyle(params), [params]);
    const activeDirection = directionOptions.find((item) => item.value === params.direction)?.label || "左侧光";

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
                    <div className="relative min-h-[390px] overflow-hidden rounded-lg border border-white/10 bg-[#0c1118] p-5 text-white shadow-inner">
                        <div className="absolute inset-x-0 top-0 h-px bg-white/12" />
                        <div className="flex items-center justify-between text-xs text-white/55">
                            <span>{params.mode === "front" ? "正面布光" : "空间布光"}</span>
                            <span>{activeDirection}</span>
                        </div>

                        <div className="relative mx-auto mt-8 grid h-60 max-w-[290px] place-items-center" aria-label={`${activeDirection}预览`}>
                            <div className="absolute inset-x-5 bottom-7 h-10 rounded-[50%] bg-black/55 blur-xl" />
                            <div className="absolute size-40 rounded-full border border-white/10" style={preview.sphere} />
                            <div className="absolute size-3 rounded-full border border-white/70" style={preview.source} />
                            <div className="absolute bottom-1 left-1/2 h-px w-44 -translate-x-1/2 bg-white/15" />
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
                                            onClick={() => update("direction", item.value)}
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
    const sourcePositions: Record<CanvasLightingDirection, { left: string; top: string }> = {
        front: { left: "50%", top: "49%" },
        left: { left: "9%", top: "50%" },
        top: { left: "50%", top: "7%" },
        back: { left: "82%", top: "18%" },
        right: { left: "91%", top: "50%" },
        bottom: { left: "50%", top: "91%" },
    };
    const highlights: Record<CanvasLightingDirection, string> = {
        front: "50% 42%",
        left: "27% 43%",
        top: "48% 20%",
        back: "76% 24%",
        right: "73% 43%",
        bottom: "50% 78%",
    };
    const color = temperatureColor(params.temperature);
    const intensity = 0.24 + params.brightness / 145;
    return {
        source: { ...sourcePositions[params.direction], transform: "translate(-50%, -50%)", background: color, boxShadow: `0 0 22px 7px ${withAlpha(color, 0.32)}` },
        sphere: {
            background: `radial-gradient(circle at ${highlights[params.direction]}, ${withAlpha(color, Math.min(0.95, intensity))} 0%, rgba(86,100,118,.48) 28%, rgba(16,22,30,.96) 72%)`,
            boxShadow: params.direction === "back" ? `0 0 34px ${withAlpha(color, 0.38)}, inset 0 -22px 36px rgba(0,0,0,.55)` : `inset 0 -24px 38px rgba(0,0,0,.62), 0 18px 34px rgba(0,0,0,.42)`,
            transform: params.mode === "perspective" ? "perspective(420px) rotateY(-10deg) rotateX(5deg)" : undefined,
        },
    };
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

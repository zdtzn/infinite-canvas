import { useMemo, useRef, useState } from "react";
import { Collapse, Segmented, Slider, Tooltip } from "antd";
import { BrainCircuit, Clipboard, Droplets, ImagePlus, Sparkles, X } from "lucide-react";

import { useCopyText } from "@/hooks/use-copy-text";
import { buildColorHarmonies, formatColorValue } from "./color-engine";
import { ColorSourceImage } from "./color-source-image";
import { mergeColorSettings } from "./settings";
import { applyColorPreset, COLOR_PRESETS } from "./presets";
import { COLOR_CURVE_CHANNELS, COLOR_HSL_CHANNELS, type AnalyzedColor, type ColorAlchemyDocument, type ColorCurveChannel, type ColorHslChannel, type ColorSettings, type ColorValueFormat } from "./types";

const HSL_LABELS: Record<ColorHslChannel, string> = { red: "红", orange: "橙", yellow: "黄", green: "绿", cyan: "青", blue: "蓝", purple: "紫", magenta: "洋红" };
const HSL_SWATCHES: Record<ColorHslChannel, string> = { red: "#e45b55", orange: "#e99545", yellow: "#dfc84d", green: "#64a66a", cyan: "#58aeb5", blue: "#5e82c8", purple: "#8b6bc1", magenta: "#c0659b" };
const CURVE_LABELS: Record<ColorCurveChannel, string> = { rgb: "RGB", red: "R", green: "G", blue: "B" };

export function ColorControlPanel({
    document,
    analyzing,
    onSettingsChange,
    onCommit,
    onApplyAi,
    onReferenceUpload,
    onBorrowColors,
}: {
    document: ColorAlchemyDocument;
    analyzing: boolean;
    onSettingsChange: (settings: ColorSettings) => void;
    onCommit: () => void;
    onApplyAi: () => void;
    onReferenceUpload: (file: File) => void;
    onBorrowColors: () => void;
}) {
    const copyText = useCopyText();
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const [hslChannel, setHslChannel] = useState<ColorHslChannel>("red");
    const [curveChannel, setCurveChannel] = useState<ColorCurveChannel>("rgb");
    const [colorValueFormat, setColorValueFormat] = useState<ColorValueFormat>("hex");
    const analysis = document.analysis;
    const settings = document.settings;
    const activePreset = COLOR_PRESETS.find((preset) => preset.id === settings.preset);
    const harmonies = useMemo(() => (analysis ? buildColorHarmonies(analysis.palette.primary) : []), [analysis]);

    const patch = (value: Parameters<typeof mergeColorSettings>[1]) => onSettingsChange(mergeColorSettings(settings, { ...value, preset: null }));
    const copyColor = (color: AnalyzedColor) => {
        copyText(formatColorValue(color, colorValueFormat), `${colorValueFormat.toUpperCase()} 已复制`);
    };

    const advancedItems = [
        {
            key: "hsl",
            label: "HSL",
            children: (
                <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-1.5">
                        {COLOR_HSL_CHANNELS.map((channel) => (
                            <button
                                key={channel}
                                type="button"
                                className={`flex h-8 items-center justify-center gap-1 rounded text-[11px] transition ${hslChannel === channel ? "bg-white/12 text-white" : "bg-white/4 text-white/45 hover:bg-white/8"}`}
                                onClick={() => setHslChannel(channel)}
                            >
                                <span className="size-2 rounded-full" style={{ background: HSL_SWATCHES[channel] }} />
                                {HSL_LABELS[channel]}
                            </button>
                        ))}
                    </div>
                    <ControlSlider label="色相" value={settings.hsl[hslChannel].hue} onChange={(value) => patch({ hsl: { [hslChannel]: { hue: value } } })} onCommit={onCommit} />
                    <ControlSlider label="饱和" value={settings.hsl[hslChannel].saturation} onChange={(value) => patch({ hsl: { [hslChannel]: { saturation: value } } })} onCommit={onCommit} />
                    <ControlSlider label="明度" value={settings.hsl[hslChannel].lightness} onChange={(value) => patch({ hsl: { [hslChannel]: { lightness: value } } })} onCommit={onCommit} />
                </div>
            ),
        },
        {
            key: "curves",
            label: "RGB 曲线",
            children: (
                <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-1">
                        {COLOR_CURVE_CHANNELS.map((channel) => (
                            <button key={channel} type="button" className={`h-7 rounded text-[11px] ${curveChannel === channel ? "bg-white/12 text-white" : "bg-white/4 text-white/45"}`} onClick={() => setCurveChannel(channel)}>
                                {CURVE_LABELS[channel]}
                            </button>
                        ))}
                    </div>
                    <CurvePreview curve={settings.curves[curveChannel]} color={curveChannel === "red" ? "#ef6a62" : curveChannel === "green" ? "#62bd7b" : curveChannel === "blue" ? "#6d8ee8" : "#d7b46a"} />
                    {(["暗部", "中调", "高光"] as const).map((label, index) => (
                        <ControlSlider
                            key={label}
                            label={label}
                            value={settings.curves[curveChannel][index]}
                            onChange={(value) => {
                                const curve = [...settings.curves[curveChannel]] as [number, number, number];
                                curve[index] = value;
                                patch({ curves: { [curveChannel]: curve } });
                            }}
                            onCommit={onCommit}
                        />
                    ))}
                </div>
            ),
        },
        {
            key: "split",
            label: "分离色调",
            children: (
                <div className="space-y-4">
                    <ControlSlider label="阴影色相" value={settings.splitTone.shadowHue} min={0} max={360} onChange={(value) => patch({ splitTone: { shadowHue: value } })} onCommit={onCommit} color={`hsl(${settings.splitTone.shadowHue} 70% 55%)`} />
                    <ControlSlider label="阴影浓度" value={settings.splitTone.shadowSaturation} min={0} max={100} onChange={(value) => patch({ splitTone: { shadowSaturation: value } })} onCommit={onCommit} />
                    <ControlSlider
                        label="高光色相"
                        value={settings.splitTone.highlightHue}
                        min={0}
                        max={360}
                        onChange={(value) => patch({ splitTone: { highlightHue: value } })}
                        onCommit={onCommit}
                        color={`hsl(${settings.splitTone.highlightHue} 70% 55%)`}
                    />
                    <ControlSlider label="高光浓度" value={settings.splitTone.highlightSaturation} min={0} max={100} onChange={(value) => patch({ splitTone: { highlightSaturation: value } })} onCommit={onCommit} />
                    <ControlSlider label="平衡" value={settings.splitTone.balance} onChange={(value) => patch({ splitTone: { balance: value } })} onCommit={onCommit} />
                </div>
            ),
        },
        {
            key: "detail",
            label: "细节与质感",
            children: (
                <div className="space-y-4">
                    <ControlSlider label="锐化" value={settings.sharpen} min={0} max={100} onChange={(value) => patch({ sharpen: value })} onCommit={onCommit} />
                    <ControlSlider label="清晰度" value={settings.clarity} onChange={(value) => patch({ clarity: value })} onCommit={onCommit} />
                    <ControlSlider label="纹理" value={settings.texture} onChange={(value) => patch({ texture: value })} onCommit={onCommit} />
                    <ControlSlider label="噪点" value={settings.noise} min={0} max={100} onChange={(value) => patch({ noise: value })} onCommit={onCommit} />
                    <ControlSlider label="暗角" value={settings.vignette} onChange={(value) => patch({ vignette: value })} onCommit={onCommit} />
                </div>
            ),
        },
    ];

    return (
        <aside className="thin-scrollbar h-full overflow-y-auto border-l border-white/8 bg-[#151719]/94 text-[#eeeae0] backdrop-blur-xl">
            <div className="space-y-6 p-4 pb-8">
                <section className="rounded-md border border-[#d7b46a]/22 bg-[#d7b46a]/5 p-3.5">
                    <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-[#e0bd75]" />
                        <h2 className="text-sm font-semibold">AI 炼彩</h2>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/48">{analysis ? `${analysis.mood}。已解析色彩、光影与整体氛围。` : analyzing ? "正在读取画面的色彩关系…" : "等待画面分析。"}</p>
                    {analysis ? (
                        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[10px] text-white/48">
                            <Metric label="明度" value={Math.round(analysis.luminance * 100)} />
                            <Metric label="反差" value={Math.round(analysis.contrast * 100)} />
                            <Metric label="色彩" value={Math.round(analysis.saturation * 100)} />
                        </div>
                    ) : null}
                    <button
                        type="button"
                        disabled={!analysis || analyzing}
                        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded bg-[#d7b46a] text-xs font-semibold text-[#18140d] transition hover:bg-[#e5c783] disabled:cursor-not-allowed disabled:opacity-35"
                        onClick={onApplyAi}
                    >
                        <BrainCircuit className="size-4" />
                        应用推荐方案
                    </button>
                </section>

                {activePreset ? (
                    <section>
                        <SectionTitle title={`秘卷强度 · ${activePreset.name}`} />
                        <ControlSlider label="强度" value={settings.presetIntensity} min={0} max={100} onChange={(value) => onSettingsChange(applyColorPreset(activePreset, value))} onCommit={onCommit} />
                    </section>
                ) : null}

                {settings.lutId ? (
                    <section>
                        <div className="flex items-center justify-between">
                            <SectionTitle title="胶片 LUT 强度" />
                            <Tooltip title="清除当前胶片滤镜">
                                <button
                                    type="button"
                                    className="grid size-6 place-items-center rounded text-white/45 transition hover:bg-white/8 hover:text-white"
                                    aria-label="清除当前胶片滤镜"
                                    onClick={() => {
                                        onSettingsChange(mergeColorSettings(settings, { lutId: null, lutIntensity: 100 }));
                                        onCommit();
                                    }}
                                >
                                    <X className="size-3.5" />
                                </button>
                            </Tooltip>
                        </div>
                        <ControlSlider label="强度" value={settings.lutIntensity} min={0} max={100} onChange={(value) => onSettingsChange(mergeColorSettings(settings, { lutIntensity: value }))} onCommit={onCommit} />
                    </section>
                ) : null}

                <section>
                    <SectionTitle title="基础调整" />
                    <div className="space-y-4">
                        <ControlSlider label="曝光" value={settings.exposure} onChange={(value) => patch({ exposure: value })} onCommit={onCommit} />
                        <ControlSlider label="亮度" value={settings.brightness} onChange={(value) => patch({ brightness: value })} onCommit={onCommit} />
                        <ControlSlider label="对比度" value={settings.contrast} onChange={(value) => patch({ contrast: value })} onCommit={onCommit} />
                        <ControlSlider label="高光" value={settings.highlights} onChange={(value) => patch({ highlights: value })} onCommit={onCommit} />
                        <ControlSlider label="阴影" value={settings.shadows} onChange={(value) => patch({ shadows: value })} onCommit={onCommit} />
                        <ControlSlider label="黑色" value={settings.blacks} onChange={(value) => patch({ blacks: value })} onCommit={onCommit} />
                    </div>
                </section>

                <section>
                    <SectionTitle title="色彩调整" />
                    <div className="space-y-4">
                        <ControlSlider label="饱和度" value={settings.saturation} onChange={(value) => patch({ saturation: value })} onCommit={onCommit} />
                        <ControlSlider label="自然饱和" value={settings.vibrance} onChange={(value) => patch({ vibrance: value })} onCommit={onCommit} />
                        <ControlSlider label="色温" value={settings.temperature} onChange={(value) => patch({ temperature: value })} onCommit={onCommit} color="linear-gradient(90deg,#6e9fd4,#ddd2bd,#d88b59)" />
                        <ControlSlider label="色调" value={settings.tint} onChange={(value) => patch({ tint: value })} onCommit={onCommit} color="linear-gradient(90deg,#6ba67a,#d8d2cb,#bd70a0)" />
                    </div>
                </section>

                <section>
                    <SectionTitle title="高级调整" />
                    <Collapse ghost size="small" items={advancedItems} className="color-alchemy-collapse -mx-2" />
                </section>

                {analysis ? (
                    <section>
                        <SectionTitle title="灵色工具" icon={<Droplets className="size-3.5" />} />
                        <Segmented
                            block
                            size="small"
                            value={colorValueFormat}
                            options={[
                                { label: "HEX", value: "hex" },
                                { label: "RGB", value: "rgb" },
                                { label: "HSL", value: "hsl" },
                            ]}
                            onChange={(value) => setColorValueFormat(value as ColorValueFormat)}
                            className="mb-3"
                        />
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: "主色", color: analysis.palette.primary },
                                { label: "辅助色", color: analysis.palette.secondary },
                                { label: "强调色", color: analysis.palette.accent },
                            ].map((item) => (
                                <Tooltip key={item.label} title={`复制 ${formatColorValue(item.color, colorValueFormat)}`}>
                                    <button type="button" className="min-w-0 overflow-hidden rounded-md border border-white/8 bg-white/4 text-left" onClick={() => copyColor(item.color)} aria-label={`复制${item.label}${colorValueFormat.toUpperCase()}`}>
                                        <span className="block h-10" style={{ background: item.color.hex }} />
                                        <span className="block min-w-0 px-2 py-1.5 text-[10px] text-white/55">
                                            <strong className="block font-medium text-white/78">{item.label}</strong>
                                            <span className="block truncate">{formatColorValue(item.color, colorValueFormat)}</span>
                                        </span>
                                    </button>
                                </Tooltip>
                            ))}
                        </div>
                        <div className="mt-3 space-y-2">
                            {harmonies.map((harmony) => (
                                <div key={harmony.label} className="flex items-center gap-2">
                                    <span className="w-14 text-[10px] text-white/38">{harmony.label}</span>
                                    <div className="flex flex-1 overflow-hidden rounded-sm">
                                        {harmony.colors.map((color) => (
                                            <Tooltip key={color.hex} title={`复制 ${formatColorValue(color, colorValueFormat)}`}>
                                                <button
                                                    type="button"
                                                    className="h-6 flex-1"
                                                    style={{ background: color.hex }}
                                                    onClick={() => copyColor(color)}
                                                    aria-label={`复制 ${colorValueFormat.toUpperCase()} ${formatColorValue(color, colorValueFormat)}`}
                                                />
                                            </Tooltip>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                <section>
                    <SectionTitle title="借色术" icon={<Clipboard className="size-3.5" />} />
                    <input
                        ref={referenceInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) onReferenceUpload(file);
                            event.currentTarget.value = "";
                        }}
                    />
                    {document.reference ? (
                        <div className="overflow-hidden rounded-md border border-white/8 bg-white/4">
                            <ColorSourceImage source={document.reference} alt="借色参考" className="aspect-[16/8] w-full object-cover" />
                            <div className="flex items-center justify-between gap-2 p-2.5">
                                <span className="truncate text-xs text-white/62">{document.reference.title}</span>
                                <button type="button" className="shrink-0 text-[11px] text-[#dfbd78] hover:text-[#f1d79e]" onClick={() => referenceInputRef.current?.click()}>
                                    更换
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-white/14 bg-white/3 text-xs text-white/45 transition hover:border-[#d7b46a]/45 hover:text-white/75"
                            onClick={() => referenceInputRef.current?.click()}
                        >
                            <ImagePlus className="size-4" />
                            添加参考图片
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={!document.analysis || !document.reference?.analysis}
                        className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded border border-white/12 bg-white/5 text-xs font-medium text-white/72 transition hover:bg-white/9 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        onClick={onBorrowColors}
                    >
                        <Sparkles className="size-3.5" />
                        借取色彩关系
                    </button>
                    <p className="mt-2 text-[10px] leading-4 text-white/30">只迁移色温、明暗与色彩关系，不改变主体、内容和构图。</p>
                </section>
            </div>
        </aside>
    );
}

function ControlSlider({ label, value, onChange, onCommit, min = -100, max = 100, color }: { label: string; value: number; onChange: (value: number) => void; onCommit: () => void; min?: number; max?: number; color?: string }) {
    return (
        <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-white/52">{label}</span>
                <span className="min-w-9 text-right tabular-nums text-white/70">{Math.round(value)}</span>
            </div>
            {color ? <div className="mb-[-10px] h-1 rounded-full opacity-75" style={{ background: color }} /> : null}
            <Slider min={min} max={max} value={value} tooltip={{ open: false }} onChange={onChange} onChangeComplete={onCommit} />
        </div>
    );
}

function CurvePreview({ curve, color }: { curve: [number, number, number]; color: string }) {
    const points = [0, 25, 50, 75, 100]
        .map((x) => {
            const value = x / 100;
            const shift = ((1 - value) ** 2 * curve[0] + 4 * value * (1 - value) * curve[1] + value ** 2 * curve[2]) / 4;
            return `${x},${100 - Math.min(100, Math.max(0, x + shift))}`;
        })
        .join(" ");
    return (
        <svg viewBox="0 0 100 100" className="h-24 w-full rounded-md border border-white/8 bg-black/20">
            <path d="M0 100 L100 0" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
            <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
        </svg>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <span className="rounded bg-white/5 px-1 py-1.5">
            <strong className="block text-xs font-medium text-white/75">{value}</strong>
            {label}
        </span>
    );
}

function SectionTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
    return (
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-white/78">
            {icon}
            {title}
        </div>
    );
}

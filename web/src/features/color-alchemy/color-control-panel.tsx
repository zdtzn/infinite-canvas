import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented, Tooltip } from "antd";
import { BrainCircuit, Check, ChevronDown, Clipboard, Droplets, ImagePlus, Pipette, RotateCcw, Sparkles, X } from "lucide-react";

import { useCopyText } from "@/hooks/use-copy-text";
import { ColorAdjustmentRow } from "./color-adjustment-row";
import { buildColorHarmonies, formatColorValue } from "./color-engine";
import { ColorSourceImage } from "./color-source-image";
import { applyColorPreset, COLOR_PRESETS, QUICK_COLOR_PRESETS } from "./presets";
import { createDefaultColorSettings, mergeColorSettings } from "./settings";
import { COLOR_HSL_CHANNELS, type AnalyzedColor, type ColorAlchemyDocument, type ColorHslChannel, type ColorPreset, type ColorSettings, type ColorSettingsPatch, type ColorValueFormat } from "./types";

const HSL_LABELS: Record<ColorHslChannel, string> = { red: "红", orange: "橙", yellow: "黄", green: "绿", cyan: "青", blue: "蓝", purple: "紫", magenta: "洋红" };
const HSL_SWATCHES: Record<ColorHslChannel, string> = { red: "#e45b55", orange: "#e99545", yellow: "#dfc84d", green: "#64a66a", cyan: "#58aeb5", blue: "#5e82c8", purple: "#8b6bc1", magenta: "#c0659b" };

type AdvancedModule = "hsl" | "split" | "detail";
type AiStage = "idle" | "analyzing" | "correcting" | "done";

export function ColorControlPanel({
    document,
    analyzing,
    onSettingsChange,
    onCommit,
    onApplyAi,
    onApplyPreset,
    onReferenceUpload,
    onBorrowColors,
    pickedColor,
}: {
    document: ColorAlchemyDocument;
    analyzing: boolean;
    onSettingsChange: (settings: ColorSettings) => void;
    onCommit: () => void;
    onApplyAi: () => void;
    onApplyPreset: (preset: ColorPreset) => void;
    onReferenceUpload: (file: File) => void;
    onBorrowColors: () => void;
    pickedColor: AnalyzedColor | null;
}) {
    const copyText = useCopyText();
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const aiRunRef = useRef(0);
    const [panelTab, setPanelTab] = useState<"adjust" | "tools">("adjust");
    const [hslChannel, setHslChannel] = useState<ColorHslChannel>("red");
    const [colorValueFormat, setColorValueFormat] = useState<ColorValueFormat>("hex");
    const [advancedOpen, setAdvancedOpen] = useState<AdvancedModule | null>(null);
    const [showMoreLight, setShowMoreLight] = useState(false);
    const [aiStage, setAiStage] = useState<AiStage>("idle");
    const defaults = useMemo(createDefaultColorSettings, []);
    const analysis = document.analysis;
    const settings = document.settings;
    const activePreset = COLOR_PRESETS.find((preset) => preset.id === settings.preset);
    const harmonies = useMemo(() => (analysis ? buildColorHarmonies(analysis.palette.primary) : []), [analysis]);

    useEffect(
        () => () => {
            aiRunRef.current += 1;
        },
        [],
    );

    const patch = (value: ColorSettingsPatch) => onSettingsChange(mergeColorSettings(settings, { ...value, preset: null }));
    const copyColor = (color: AnalyzedColor) => copyText(formatColorValue(color, colorValueFormat), `${colorValueFormat.toUpperCase()} 已复制`);
    const resetValues = (value: ColorSettingsPatch) => {
        onSettingsChange(mergeColorSettings(settings, { ...value, preset: null }));
        onCommit();
    };

    const applyAi = async () => {
        if (!analysis || analyzing || aiStage === "analyzing" || aiStage === "correcting") return;
        const run = aiRunRef.current + 1;
        aiRunRef.current = run;
        setAiStage("analyzing");
        await wait(180);
        if (aiRunRef.current !== run) return;
        setAiStage("correcting");
        await wait(320);
        if (aiRunRef.current !== run) return;
        onApplyAi();
        setAiStage("done");
        await wait(1_200);
        if (aiRunRef.current === run) setAiStage("idle");
    };

    const aiStatus = analyzing || !analysis ? "正在分析画面…" : aiStage === "analyzing" ? "正在分析画面…" : aiStage === "correcting" ? "正在校正色彩…" : aiStage === "done" ? "灵彩优化完成" : `画面已就绪 · ${analysis.mood}`;

    return (
        <aside className="color-alchemy-inspector">
            <div className="color-inspector-tabs" role="tablist" aria-label="灵彩设计面板">
                <button type="button" role="tab" aria-selected={panelTab === "adjust"} className={panelTab === "adjust" ? "is-active" : ""} onClick={() => setPanelTab("adjust")}>
                    调整
                </button>
                <button type="button" role="tab" aria-selected={panelTab === "tools"} className={panelTab === "tools" ? "is-active" : ""} onClick={() => setPanelTab("tools")}>
                    工具
                </button>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                {panelTab === "adjust" ? (
                    <div className="space-y-0 pb-8">
                        <section className={`color-ai-panel ${aiStage !== "idle" ? "is-processing" : ""}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                                        <Sparkles className="size-4 text-[#d7b46a]" />
                                        AI 灵彩
                                    </div>
                                    <p className="mt-1 truncate text-[11px] text-white/44" aria-live="polite">
                                        {aiStatus}
                                    </p>
                                </div>
                                <button type="button" className="color-ai-button" disabled={!analysis || analyzing || aiStage === "analyzing" || aiStage === "correcting"} onClick={() => void applyAi()}>
                                    {aiStage === "done" ? <Check className="size-4" /> : <BrainCircuit className="size-4" />}
                                    {aiStage === "done" ? "已完成" : "AI 灵彩"}
                                </button>
                            </div>
                            {analysis ? (
                                <div className="mt-3 flex items-center gap-3 text-[11px] text-white/40">
                                    <span>明度 {Math.round(analysis.luminance * 100)}</span>
                                    <span>反差 {Math.round(analysis.contrast * 100)}</span>
                                    <span>色彩 {Math.round(analysis.saturation * 100)}</span>
                                </div>
                            ) : null}
                            <span className="color-ai-progress" aria-hidden="true" />
                        </section>

                        <section className="color-inspector-section">
                            <SectionHeader title="快捷预设" />
                            <div className="grid grid-cols-3 gap-2">
                                {QUICK_COLOR_PRESETS.map((preset) => (
                                    <button key={preset.id} type="button" className={`color-quick-preset ${settings.preset === preset.id ? "is-active" : ""}`} onClick={() => onApplyPreset(preset)} title={preset.description}>
                                        <span className="size-1.5 rounded-full" style={{ background: preset.accent }} aria-hidden="true" />
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            {activePreset ? (
                                <div className="mt-3 border-t border-white/7 pt-3">
                                    <ColorAdjustmentRow
                                        label={`${activePreset.name}强度`}
                                        value={settings.presetIntensity}
                                        min={0}
                                        max={100}
                                        defaultValue={100}
                                        onChange={(value) => onSettingsChange(applyColorPreset(activePreset, value))}
                                        onCommit={onCommit}
                                    />
                                </div>
                            ) : null}
                            {settings.lutId ? (
                                <div className="mt-3 border-t border-white/7 pt-3">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-[11px] text-white/46">胶片 LUT</span>
                                        <Tooltip title="清除当前胶片滤镜">
                                            <button
                                                type="button"
                                                className="color-subtle-icon"
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
                                    <ColorAdjustmentRow
                                        label="滤镜强度"
                                        value={settings.lutIntensity}
                                        min={0}
                                        max={100}
                                        defaultValue={100}
                                        onChange={(value) => onSettingsChange(mergeColorSettings(settings, { lutIntensity: value }))}
                                        onCommit={onCommit}
                                    />
                                </div>
                            ) : null}
                        </section>

                        <AdjustmentSection
                            title="常用调整"
                            onReset={() => resetValues({ exposure: defaults.exposure, brightness: defaults.brightness, contrast: defaults.contrast, highlights: defaults.highlights, shadows: defaults.shadows, blacks: defaults.blacks })}
                        >
                            <ColorAdjustmentRow label="曝光" value={settings.exposure} onChange={(value) => patch({ exposure: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="对比度" value={settings.contrast} onChange={(value) => patch({ contrast: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="高光" value={settings.highlights} onChange={(value) => patch({ highlights: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="阴影" value={settings.shadows} onChange={(value) => patch({ shadows: value })} onCommit={onCommit} />
                            <button type="button" className="color-more-light" aria-expanded={showMoreLight} onClick={() => setShowMoreLight((value) => !value)}>
                                <span>更多光影</span>
                                <span className="flex items-center gap-2 text-[10px] text-white/30">
                                    亮度 {Math.round(settings.brightness)} · 黑色 {Math.round(settings.blacks)}
                                    <ChevronDown className={`size-3.5 transition-transform ${showMoreLight ? "rotate-180" : ""}`} />
                                </span>
                            </button>
                            {showMoreLight ? (
                                <div className="space-y-3 pt-1">
                                    <ColorAdjustmentRow label="亮度" value={settings.brightness} onChange={(value) => patch({ brightness: value })} onCommit={onCommit} />
                                    <ColorAdjustmentRow label="黑色" value={settings.blacks} onChange={(value) => patch({ blacks: value })} onCommit={onCommit} />
                                </div>
                            ) : null}
                        </AdjustmentSection>

                        <AdjustmentSection title="色彩调整" onReset={() => resetValues({ saturation: defaults.saturation, vibrance: defaults.vibrance, temperature: defaults.temperature, tint: defaults.tint })}>
                            <ColorAdjustmentRow label="饱和度" value={settings.saturation} onChange={(value) => patch({ saturation: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="自然饱和" value={settings.vibrance} onChange={(value) => patch({ vibrance: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="色温" value={settings.temperature} spectrum="linear-gradient(90deg,#668fc5,#bfc1bd,#cf835e)" onChange={(value) => patch({ temperature: value })} onCommit={onCommit} />
                            <ColorAdjustmentRow label="色调" value={settings.tint} spectrum="linear-gradient(90deg,#5f9b73,#bfc1bd,#ad6e9a)" onChange={(value) => patch({ tint: value })} onCommit={onCommit} />
                        </AdjustmentSection>

                        <section className="color-inspector-section">
                            <SectionHeader title="高级调整" />
                            <div className="color-advanced-list">
                                <AdvancedAdjustmentModule
                                    title="HSL"
                                    summary={`${HSL_LABELS[hslChannel]}色 · 色相 ${Math.round(settings.hsl[hslChannel].hue)}`}
                                    open={advancedOpen === "hsl"}
                                    onToggle={() => setAdvancedOpen((value) => (value === "hsl" ? null : "hsl"))}
                                >
                                    <div className="mb-4 grid grid-cols-8 gap-1">
                                        {COLOR_HSL_CHANNELS.map((channel) => (
                                            <button key={channel} type="button" className={`color-hsl-channel ${hslChannel === channel ? "is-active" : ""}`} onClick={() => setHslChannel(channel)} aria-label={`${HSL_LABELS[channel]}色通道`}>
                                                <span style={{ background: HSL_SWATCHES[channel] }} />
                                                <small>{HSL_LABELS[channel]}</small>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="space-y-3">
                                        <ColorAdjustmentRow label="色相" value={settings.hsl[hslChannel].hue} onChange={(value) => patch({ hsl: { [hslChannel]: { hue: value } } })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="饱和" value={settings.hsl[hslChannel].saturation} onChange={(value) => patch({ hsl: { [hslChannel]: { saturation: value } } })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="明度" value={settings.hsl[hslChannel].lightness} onChange={(value) => patch({ hsl: { [hslChannel]: { lightness: value } } })} onCommit={onCommit} />
                                    </div>
                                </AdvancedAdjustmentModule>

                                <AdvancedAdjustmentModule
                                    title="分离色调"
                                    summary="阴影与高光的综合色彩"
                                    swatches={[`hsl(${settings.splitTone.shadowHue} 70% 55%)`, `hsl(${settings.splitTone.highlightHue} 70% 55%)`]}
                                    open={advancedOpen === "split"}
                                    onToggle={() => setAdvancedOpen((value) => (value === "split" ? null : "split"))}
                                >
                                    <div className="space-y-3">
                                        <ColorAdjustmentRow
                                            label="阴影色相"
                                            value={settings.splitTone.shadowHue}
                                            min={0}
                                            max={360}
                                            defaultValue={220}
                                            spectrum="linear-gradient(90deg,#e45b55,#dfc84d,#64a66a,#58aeb5,#5e82c8,#c0659b,#e45b55)"
                                            onChange={(value) => patch({ splitTone: { shadowHue: value } })}
                                            onCommit={onCommit}
                                        />
                                        <ColorAdjustmentRow label="阴影浓度" value={settings.splitTone.shadowSaturation} min={0} max={100} onChange={(value) => patch({ splitTone: { shadowSaturation: value } })} onCommit={onCommit} />
                                        <ColorAdjustmentRow
                                            label="高光色相"
                                            value={settings.splitTone.highlightHue}
                                            min={0}
                                            max={360}
                                            defaultValue={40}
                                            spectrum="linear-gradient(90deg,#e45b55,#dfc84d,#64a66a,#58aeb5,#5e82c8,#c0659b,#e45b55)"
                                            onChange={(value) => patch({ splitTone: { highlightHue: value } })}
                                            onCommit={onCommit}
                                        />
                                        <ColorAdjustmentRow label="高光浓度" value={settings.splitTone.highlightSaturation} min={0} max={100} onChange={(value) => patch({ splitTone: { highlightSaturation: value } })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="平衡" value={settings.splitTone.balance} onChange={(value) => patch({ splitTone: { balance: value } })} onCommit={onCommit} />
                                    </div>
                                </AdvancedAdjustmentModule>

                                <AdvancedAdjustmentModule
                                    title="细节与质感"
                                    summary={`锐化 ${Math.round(settings.sharpen)} · 清晰 ${Math.round(settings.clarity)}`}
                                    open={advancedOpen === "detail"}
                                    onToggle={() => setAdvancedOpen((value) => (value === "detail" ? null : "detail"))}
                                >
                                    <div className="space-y-3">
                                        <ColorAdjustmentRow label="锐化" value={settings.sharpen} min={0} max={100} onChange={(value) => patch({ sharpen: value })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="清晰度" value={settings.clarity} onChange={(value) => patch({ clarity: value })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="纹理" value={settings.texture} onChange={(value) => patch({ texture: value })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="噪点" value={settings.noise} min={0} max={100} onChange={(value) => patch({ noise: value })} onCommit={onCommit} />
                                        <ColorAdjustmentRow label="暗角" value={settings.vignette} onChange={(value) => patch({ vignette: value })} onCommit={onCommit} />
                                    </div>
                                </AdvancedAdjustmentModule>
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="space-y-0 pb-8">
                        {analysis ? (
                            <section className="color-inspector-section border-t-0">
                                <SectionHeader title="灵色工具" icon={<Droplets className="size-4" />} />
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
                                    className="color-alchemy-segmented mb-4"
                                />
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: "主色", color: analysis.palette.primary },
                                        { label: "辅助色", color: analysis.palette.secondary },
                                        { label: "强调色", color: analysis.palette.accent },
                                    ].map((item) => (
                                        <Tooltip key={item.label} title={`复制 ${formatColorValue(item.color, colorValueFormat)}`}>
                                            <button type="button" className="color-palette-card" onClick={() => copyColor(item.color)} aria-label={`复制${item.label}${colorValueFormat.toUpperCase()}`}>
                                                <span className="block h-12" style={{ background: item.color.hex }} />
                                                <span className="block min-w-0 px-2 py-2 text-[10px] text-white/44">
                                                    <strong className="block font-medium text-white/76">{item.label}</strong>
                                                    <span className="block truncate">{formatColorValue(item.color, colorValueFormat)}</span>
                                                </span>
                                            </button>
                                        </Tooltip>
                                    ))}
                                </div>
                                {pickedColor ? (
                                    <button type="button" className="color-picked-result" onClick={() => copyColor(pickedColor)} aria-label={`复制吸色结果${colorValueFormat.toUpperCase()}`}>
                                        <Pipette className="size-4 text-[#d7b46a]" />
                                        <span className="size-9 shrink-0 rounded border border-white/15" style={{ background: pickedColor.hex }} />
                                        <span className="min-w-0 flex-1 text-left">
                                            <strong className="block text-xs font-medium text-white/80">{formatColorValue(pickedColor, colorValueFormat)}</strong>
                                            <span className="block truncate text-[10px] text-white/38">吸色结果 · 点击复制</span>
                                        </span>
                                    </button>
                                ) : null}
                                <div className="mt-5 space-y-3">
                                    {harmonies.map((harmony) => (
                                        <div key={harmony.label} className="flex items-center gap-3">
                                            <span className="w-14 text-[11px] text-white/38">{harmony.label}</span>
                                            <div className="flex h-7 flex-1 overflow-hidden rounded">
                                                {harmony.colors.map((color) => (
                                                    <Tooltip key={color.hex} title={`复制 ${formatColorValue(color, colorValueFormat)}`}>
                                                        <button
                                                            type="button"
                                                            className="flex-1 transition hover:opacity-80"
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

                        <section className="color-inspector-section">
                            <SectionHeader title="借色术" icon={<Clipboard className="size-4" />} />
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
                                <div className="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]">
                                    <ColorSourceImage source={document.reference} alt="借色参考" className="aspect-[16/8] w-full object-cover" />
                                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                                        <span className="truncate text-xs text-white/62">{document.reference.title}</span>
                                        <button type="button" className="text-[11px] text-[#d7b46a] hover:text-[#ecd39a]" onClick={() => referenceInputRef.current?.click()}>
                                            更换
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" className="color-reference-upload" onClick={() => referenceInputRef.current?.click()}>
                                    <ImagePlus className="size-4" />
                                    添加参考图片
                                </button>
                            )}
                            <button type="button" disabled={!document.analysis || !document.reference?.analysis} className="color-borrow-button" onClick={onBorrowColors}>
                                <Sparkles className="size-4" />
                                借取色彩关系
                            </button>
                            <p className="mt-2 text-[10px] leading-4 text-white/28">只迁移色温、明暗与色彩关系，不改变主体和构图。</p>
                        </section>
                    </div>
                )}
            </div>
        </aside>
    );
}

function AdjustmentSection({ title, onReset, children }: { title: string; onReset: () => void; children: React.ReactNode }) {
    return (
        <section className="color-inspector-section">
            <SectionHeader title={title} onReset={onReset} />
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function SectionHeader({ title, icon, onReset }: { title: string; icon?: React.ReactNode; onReset?: () => void }) {
    return (
        <div className="mb-4 flex h-5 items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/78">
                {icon}
                {title}
            </div>
            {onReset ? (
                <Tooltip title="恢复本组默认值">
                    <button type="button" className="color-subtle-icon" onClick={onReset} aria-label={`恢复${title}默认值`}>
                        <RotateCcw className="size-3.5" />
                    </button>
                </Tooltip>
            ) : null}
        </div>
    );
}

function AdvancedAdjustmentModule({ title, summary, swatches, open, onToggle, children }: { title: string; summary: string; swatches?: string[]; open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <div className={`color-advanced-module ${open ? "is-open" : ""}`}>
            <button type="button" className="color-advanced-trigger" aria-expanded={open} onClick={onToggle}>
                <span className="min-w-0 flex-1 text-left">
                    <strong>{title}</strong>
                    <small>{summary}</small>
                </span>
                {swatches ? (
                    <span className="flex -space-x-1" aria-hidden="true">
                        {swatches.map((color) => (
                            <span key={color} className="size-4 rounded-full border border-[#17191c]" style={{ background: color }} />
                        ))}
                    </span>
                ) : null}
                <ChevronDown className={`size-4 text-white/32 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? <div className="color-advanced-content">{children}</div> : null}
        </div>
    );
}

function wait(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

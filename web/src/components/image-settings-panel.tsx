import { type ReactNode, useState } from "react";
import { ConfigProvider, Select, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { deriveImageModelCapabilities } from "@/stores/model-capabilities";

const resolutionOptions = [
    { value: "low", label: "1K" },
    { value: "medium", label: "2K" },
    { value: "high", label: "4K" },
];
const generationQualityOptions = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "standard", label: "标准" },
    { value: "hd", label: "高清" },
];
const outputFormatOptions = [
    { value: "auto", label: "自动" },
    { value: "png", label: "PNG" },
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WebP" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

export const imageResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageGenerationQualityOptions = generationQualityOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageOutputFormatOptions = outputFormatOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "imageQuality" | "imageOutputFormat" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const selectedModel = config.model || config.imageModel;
    const channel = resolveModelChannel(config, selectedModel);
    const capabilities = deriveImageModelCapabilities(modelOptionName(selectedModel), channel.apiFormat);
    const visibleResolutions = resolutionOptions.filter((item) => capabilities.resolutions.includes(item.value));
    const selectedModelName = modelOptionName(selectedModel);
    const isUuAsyncModel = isUuAsyncImageModel(channel.baseUrl, selectedModelName);
    const visibleGenerationQualities = generationQualityOptions.filter((item) => capabilities.generationQualities.includes(item.value));
    const canChooseGenerationQuality = !isUuAsyncModel && visibleGenerationQualities.some((item) => item.value !== "auto");
    const visibleOutputFormats = outputFormatOptions.filter((item) => capabilities.outputFormats.includes(item.value));
    const canChooseOutputFormat = !isUuAsyncModel && visibleOutputFormats.some((item) => item.value !== "auto");
    const visibleAspects = aspectOptions.filter((item) => {
        const value = item.value;
        return /^\d+x\d+$/i.test(value) ? capabilities.customSize : capabilities.sizes.includes(value);
    });
    const ratioAspects = visibleAspects.filter((item) => item.value !== "auto");
    const autoAspect = visibleAspects.find((item) => item.value === "auto");
    const effectiveMaxCount = Math.min(maxCount, capabilities.maxOutputs);
    const resolution = resolutionOptions.some((item) => item.value === config.quality) ? config.quality : "low";
    const imageQuality = generationQualityOptions.some((item) => item.value === config.imageQuality) ? config.imageQuality : "auto";
    const imageOutputFormat = outputFormatOptions.some((item) => item.value === config.imageOutputFormat) ? config.imageOutputFormat : "auto";
    const count = Math.max(1, Math.min(effectiveMaxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedAspect = aspectOptions.find((item) => item.value === activeSize);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0], resolution);
    const customSizeActive = /^\d+x\d+$/i.test(activeSize);
    const selectAspect = (value: string) => {
        const option = aspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.value || "auto");
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };
    const selectOutputFormat = (value: string) => {
        if (value === "jpeg" && transparentBackground) onConfigChange("background", "");
        onConfigChange("imageOutputFormat", value);
    };
    const updateTransparentBackground = (checked: boolean) => {
        if (checked && imageOutputFormat === "jpeg") onConfigChange("imageOutputFormat", "png");
        onConfigChange("background", checked ? "transparent" : "");
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>构图比例</SettingTitle>
                        {customSizeActive ? <span className="text-xs" style={{ color: theme.node.muted }}>当前为自定义尺寸</span> : null}
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {ratioAspects.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                        {autoAspect ? (
                            <OptionPill selected={activeSize === "auto"} theme={theme} onClick={() => selectAspect(autoAspect.value)}>
                                自动
                            </OptionPill>
                        ) : null}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>输出分辨率</SettingTitle>
                    <div className="grid grid-cols-3 gap-2">
                        {visibleResolutions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>生成质量</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            影响模型的细节策略与耗时，不改变输出像素尺寸
                        </div>
                    </div>
                    {canChooseGenerationQuality ? (
                        <div className="grid grid-cols-4 gap-2">
                            {visibleGenerationQualities.map((item) => (
                                <OptionPill key={item.value} selected={imageQuality === item.value} theme={theme} onClick={() => onConfigChange("imageQuality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    ) : (
                        <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            <span>自动</span>
                            <span className="min-w-0 truncate">{isUuAsyncModel ? "当前异步渠道由模型自动控制" : "当前模型未开放独立质量参数"}</span>
                        </div>
                    )}
                </div>
                <div className="space-y-2.5">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>输出格式</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            PNG 保留透明，JPEG 与 WebP 通常文件更小
                        </div>
                    </div>
                    {canChooseOutputFormat ? (
                        <span className="block" onMouseDown={(event) => event.stopPropagation()}>
                            <Select value={imageOutputFormat} options={visibleOutputFormats} className="w-full" onChange={selectOutputFormat} />
                        </span>
                    ) : (
                        <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            <span>自动</span>
                            <span className="min-w-0 truncate">{isUuAsyncModel ? "当前异步渠道未开放输出格式参数" : "当前模型由接口决定输出格式"}</span>
                        </div>
                    )}
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <SettingTitle color={theme.node.muted}>实际请求尺寸</SettingTitle>
                            <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                {activeSize === "auto" ? "由模型自动决定" : customSizeActive ? "自定义尺寸会覆盖比例和分辨率" : "按比例和分辨率精确换算"}
                            </div>
                        </div>
                        {capabilities.customSize ? (
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    16倍数对齐
                                </span>
                                <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                                </span>
                            </div>
                        ) : null}
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto" || !capabilities.customSize} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">×</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto" || !capabilities.customSize} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            开启后生成无背景的透明图像(仅部分模型可用)
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground && capabilities.transparentBackground} disabled={!capabilities.transparentBackground} onChange={updateTransparentBackground} />
                    </span>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2">
                        {[1, 2, 4].filter((value) => value <= Math.min(quickCount, effectiveMaxCount)).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={effectiveMaxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageResolutionLabel(value: string) {
    return ({ auto: "1K", high: "4K", medium: "2K", low: "1K" } as Record<string, string>)[value] || value;
}

/** Kept for existing canvas summary callers; it represents output resolution. */
export function imageQualityLabel(value: string) {
    return imageResolutionLabel(value);
}

export function imageGenerationQualityLabel(value: string) {
    return ({ auto: "自动", low: "低", medium: "中", high: "高", standard: "标准", hd: "高清" } as Record<string, string>)[value] || value;
}

export function imageOutputFormatLabel(value: string) {
    return ({ auto: "自动", png: "PNG", jpeg: "JPEG", webp: "WebP" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    return aspectOptions.find((item) => item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-md border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-md border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { value?: string; width: number; height: number }, resolution: string) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    const ratioDimensions = ratioSizeDimensions(size, resolution) || ratioSizeDimensions(fallback.value || "1:1", resolution);
    return {
        width: ratioDimensions?.width || fallback.width,
        height: ratioDimensions?.height || fallback.height,
    };
}

function ratioSizeDimensions(value: string, resolution: string) {
    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) return null;
    const ratioWidth = Number(match[1]);
    const ratioHeight = Number(match[2]);
    if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) return null;
    const requestedLongSide = ({ low: 1024, medium: 2048, high: 3840 } as Record<string, number>)[resolution] || 1024;
    const divisor = greatestCommonDivisor(ratioWidth, ratioHeight);
    const normalizedWidth = ratioWidth / divisor;
    const normalizedHeight = ratioHeight / divisor;
    const scale = Math.max(1, Math.round(requestedLongSide / (Math.max(normalizedWidth, normalizedHeight) * DIMENSION_STEP)));
    return { width: normalizedWidth * DIMENSION_STEP * scale, height: normalizedHeight * DIMENSION_STEP * scale };
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

function isUuAsyncImageModel(baseUrl: string, model: string) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        const isUuHost = ["uuapi.cc", "uuapi.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        return isUuHost && model.trim().toLowerCase() === "gpt-image-2";
    } catch {
        return false;
    }
}

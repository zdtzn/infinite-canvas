import { type ReactNode, useState } from "react";
import { ConfigProvider, Select, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { resolveImageRequestSize } from "@/lib/image-request-size";
import { imageResolutionLabel } from "@/lib/image-setting-labels";
import { modelOptionName, normalizeImageSizeSelection, type AiConfig } from "@/stores/use-config-store";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { isSadaiImage2Model, isUuAsyncGptImageModel } from "@/stores/model-capabilities";

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
    { value: "1:1", label: "1:1", name: "方图", width: 1024, height: 1024 },
    { value: "5:4", label: "5:4", name: "经典方幅", width: 1280, height: 1024 },
    { value: "4:5", label: "4:5", name: "社媒竖图", width: 1024, height: 1280 },
    { value: "4:3", label: "4:3", name: "标准横图", width: 1360, height: 1024 },
    { value: "3:4", label: "3:4", name: "标准竖图", width: 1024, height: 1360 },
    { value: "3:2", label: "3:2", name: "横图", width: 1536, height: 1024 },
    { value: "2:3", label: "2:3", name: "海报", width: 1024, height: 1536 },
    { value: "16:9", label: "16:9", name: "宽屏", width: 1824, height: 1024 },
    { value: "9:16", label: "9:16", name: "手机竖图", width: 1024, height: 1824 },
    { value: "21:9", label: "21:9", name: "电影宽屏", width: 2384, height: 1024 },
    { value: "9:21", label: "9:21", name: "超长竖屏", width: 1024, height: 2384 },
    { value: "3:1", label: "3:1", name: "超宽横幅", width: 3072, height: 1024 },
    { value: "1:3", label: "1:3", name: "长竖幅", width: 1024, height: 3072 },
    { value: "4:1", label: "4:1", name: "全景横幅", width: 4096, height: 1024 },
    { value: "1:4", label: "1:4", name: "长卷竖幅", width: 1024, height: 4096 },
    { value: "8:1", label: "8:1", name: "极宽全景", width: 4096, height: 512 },
    { value: "1:8", label: "1:8", name: "极长竖卷", width: 512, height: 4096 },
];

export const imageResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageGenerationQualityOptions = generationQualityOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageOutputFormatOptions = outputFormatOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.value, label: `${item.name} (${item.label})` }));
export { imageGenerationQualityLabel, imageOutputFormatLabel, imageQualityLabel, imageResolutionLabel, imageSizeLabel } from "@/lib/image-setting-labels";

type ImageSettingsPanelProps = {
    config: AiConfig;
    selectedModel: string;
    onConfigChange: (key: "quality" | "imageQuality" | "imageOutputFormat" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, selectedModel, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const resolved = resolveImageModelSettings(config, selectedModel, maxCount);
    const channel = resolved.channel;
    const capabilities = resolved.capabilities;
    const effectiveConfig = resolved.config;
    const visibleResolutions = resolutionOptions.filter((item) => capabilities.resolutions.includes(item.value));
    const automaticResolution = capabilities.resolutions.length === 1 && capabilities.resolutions[0] === "auto";
    const selectedModelName = modelOptionName(selectedModel);
    const isUuAsyncModel = isUuAsyncGptImageModel(channel.baseUrl, selectedModelName);
    const isSadaiModel = isSadaiImage2Model(channel.baseUrl, selectedModelName);
    const visibleGenerationQualities = generationQualityOptions.filter((item) => capabilities.generationQualities.includes(item.value));
    const canChooseGenerationQuality = !isUuAsyncModel && visibleGenerationQualities.some((item) => item.value !== "auto");
    // A selected output type is enforced while saving/downloading, even when a gateway ignores output_format.
    const visibleOutputFormats = outputFormatOptions;
    const canChooseOutputFormat = true;
    const visibleAspects = aspectOptions.filter((item) => {
        const value = item.value;
        return /^\d+x\d+$/i.test(value) ? capabilities.customSize : capabilities.sizes.includes(value);
    });
    const ratioAspects = visibleAspects;
    const effectiveMaxCount = Math.min(maxCount, capabilities.maxOutputs);
    const resolution = effectiveConfig.quality;
    const imageQuality = effectiveConfig.imageQuality;
    const imageOutputFormat = effectiveConfig.imageOutputFormat;
    const count = Number(effectiveConfig.count);
    const activeSize = normalizeImageSizeSelection(effectiveConfig.size);
    const transparentBackground = effectiveConfig.background === "transparent";
    const selectedAspect = aspectOptions.find((item) => item.value === activeSize);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0], resolution, selectedModelName);
    const customSizeActive = /^\d+x\d+$/i.test(activeSize);
    const selectAspect = (value: string) => {
        const option = aspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.value || "1:1");
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
                        {customSizeActive ? (
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                当前为自定义尺寸
                            </span>
                        ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {ratioAspects.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-14 min-w-0 cursor-pointer flex-col items-start justify-center rounded-md border px-3 text-left transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.activeStroke : theme.node.stroke, background: selectedAspect?.value === item.value ? theme.node.fill : "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <span className="max-w-full truncate text-sm font-semibold">{item.name}</span>
                                <span className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>
                                    {item.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>输出分辨率</SettingTitle>
                    {automaticResolution ? (
                        <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            <span>自动</span>
                            <span className="min-w-0 truncate">当前模型由上游自动决定输出分辨率</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {visibleResolutions.map((item) => (
                                <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    )}
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
                            <span className="min-w-0 truncate">{isUuAsyncModel ? "当前 UU 渠道由模型自动控制" : "当前模型未开放独立质量参数"}</span>
                        </div>
                    )}
                </div>
                <div className="space-y-2.5">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>输出格式</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            自动保留渠道原格式；指定格式会在保存与下载时转换
                        </div>
                    </div>
                    {canChooseOutputFormat ? (
                        <span className="block" onMouseDown={(event) => event.stopPropagation()}>
                            <Select value={imageOutputFormat} options={visibleOutputFormats} className="w-full" onChange={selectOutputFormat} />
                        </span>
                    ) : (
                        <div className="flex h-9 items-center justify-between gap-3 rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            <span>自动</span>
                            <span className="min-w-0 truncate">{isUuAsyncModel ? "当前 UU 渠道未开放输出格式参数" : "当前模型由接口决定输出格式"}</span>
                        </div>
                    )}
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <SettingTitle color={theme.node.muted}>实际请求尺寸</SettingTitle>
                            <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                {isSadaiModel ? "生图分组按比例与分辨率档位映射；默认分组可能由上游决定" : automaticResolution ? "构图比例仍会生效，像素尺寸由模型决定" : customSizeActive ? "自定义尺寸会覆盖比例和分辨率" : "按比例和分辨率精确换算"}
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
                    {isSadaiModel ? (
                        <div className="flex h-9 items-center rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            按 {activeSize} · {imageResolutionLabel(resolution)} 请求，最终像素由 SADAI 返回
                        </div>
                    ) : automaticResolution ? (
                        <div className="flex h-9 items-center rounded-md border px-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            像素尺寸将在生成时由当前模型自动确定
                        </div>
                    ) : (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                            <DimensionInput prefix="W" value={dimensions.width} disabled={!capabilities.customSize} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                            <span className="text-lg opacity-45">×</span>
                            <DimensionInput prefix="H" value={dimensions.height} disabled={!capabilities.customSize} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                        </div>
                    )}
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
                        {[1, 2, 4]
                            .filter((value) => value <= Math.min(quickCount, effectiveMaxCount))
                            .map((value) => (
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

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { value?: string; width: number; height: number }, resolution: string, model: string) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    try {
        const resolved = resolveImageRequestSize(resolution, size || fallback.value || "1:1", model);
        const dimensions = resolved.match(/^(\d+)x(\d+)$/);
        if (dimensions) return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
    } catch {
        // Keep the settings panel usable while an invalid stale value is corrected.
    }
    return { width: fallback.width, height: fallback.height };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

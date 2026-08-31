import { createDefaultColorSettings, mergeColorSettings } from "./settings";
import type { ColorPreset, ColorSettings } from "./types";

export const COLOR_PRESETS: ColorPreset[] = [
    {
        id: "quick-natural",
        name: "自然",
        category: "摄影",
        description: "轻微平衡光影与色彩，保持画面本来的气质。",
        accent: "#98a39b",
        previewFilter: "brightness(1.02) contrast(1.03) saturate(1.03)",
        settings: { exposure: 2, contrast: 4, highlights: -8, shadows: 8, vibrance: 6, clarity: 2 },
    },
    {
        id: "quick-clear",
        name: "通透",
        category: "摄影",
        description: "打开暗部并收住高光，让画面更清晰通透。",
        accent: "#7fb2bc",
        previewFilter: "brightness(1.05) contrast(1.06) saturate(1.06)",
        settings: { exposure: 6, contrast: 8, highlights: -18, shadows: 16, blacks: -3, vibrance: 10, clarity: 6 },
    },
    {
        id: "quick-premium",
        name: "高级",
        category: "艺术",
        description: "克制饱和度，强化明暗结构与细节质感。",
        accent: "#a5a7a8",
        previewFilter: "contrast(1.11) saturate(.94)",
        settings: { exposure: 1, contrast: 12, highlights: -18, shadows: 8, blacks: -8, saturation: -5, vibrance: 5, temperature: 2, clarity: 5, vignette: 4 },
    },
    {
        id: "quick-cinema",
        name: "电影",
        category: "电影",
        description: "压低高光与黑位，形成克制的冷暖电影层次。",
        accent: "#758f99",
        previewFilter: "contrast(1.16) saturate(.88) hue-rotate(4deg)",
        settings: {
            exposure: -3,
            contrast: 18,
            highlights: -22,
            shadows: -6,
            blacks: -10,
            saturation: -8,
            temperature: -5,
            tint: 2,
            splitTone: { shadowHue: 208, shadowSaturation: 18, highlightHue: 38, highlightSaturation: 10 },
        },
    },
    {
        id: "quick-vivid",
        name: "鲜艳",
        category: "艺术",
        description: "优先提升自然饱和与局部层次，避免颜色失控。",
        accent: "#c66c58",
        previewFilter: "brightness(1.03) contrast(1.07) saturate(1.18)",
        settings: { exposure: 3, contrast: 8, highlights: -10, shadows: 8, saturation: 10, vibrance: 20, clarity: 6, texture: 4 },
    },
    {
        id: "quick-commerce",
        name: "电商",
        category: "电商",
        description: "提亮主体并增强包装与食物质感，保持颜色准确克制。",
        accent: "#c89b63",
        previewFilter: "brightness(1.06) contrast(1.08) saturate(1.06)",
        settings: { exposure: 7, brightness: 2, contrast: 10, highlights: -15, shadows: 14, blacks: -3, saturation: 2, vibrance: 10, sharpen: 12, clarity: 10, texture: 8 },
    },
    {
        id: "cinema-steel",
        name: "银幕冷峻",
        category: "电影",
        description: "压低高光，以冷青暗部建立电影层次。",
        accent: "#6ca8ad",
        previewFilter: "contrast(1.14) saturate(.82) hue-rotate(8deg)",
        settings: { exposure: -4, contrast: 18, highlights: -24, shadows: -8, saturation: -12, temperature: -14, tint: -3, splitTone: { shadowHue: 198, shadowSaturation: 22, highlightHue: 36, highlightSaturation: 8 } },
    },
    {
        id: "cinema-amber",
        name: "琥珀夜场",
        category: "电影",
        description: "暖亮部与深冷阴影形成克制的夜景张力。",
        accent: "#d4a15f",
        previewFilter: "contrast(1.18) saturate(.9) sepia(.12)",
        settings: { exposure: -6, contrast: 21, highlights: -18, shadows: -14, blacks: -8, temperature: 15, saturation: -6, splitTone: { shadowHue: 218, shadowSaturation: 18, highlightHue: 37, highlightSaturation: 24 } },
    },
    {
        id: "photo-daylight",
        name: "清透日光",
        category: "摄影",
        description: "提亮阴影与自然饱和，保持真实通透。",
        accent: "#8fc7cf",
        previewFilter: "brightness(1.05) contrast(1.04) saturate(1.08)",
        settings: { exposure: 6, brightness: 3, contrast: 6, highlights: -14, shadows: 18, vibrance: 16, temperature: -3, clarity: 5 },
    },
    {
        id: "photo-portrait",
        name: "柔雾人像",
        category: "摄影",
        description: "柔化高光与纹理，为肤色保留温润层次。",
        accent: "#d7aaa7",
        previewFilter: "brightness(1.04) contrast(.94) saturate(.96) sepia(.08)",
        settings: { exposure: 5, contrast: -8, highlights: -18, shadows: 12, blacks: 4, saturation: -4, vibrance: 8, temperature: 7, clarity: -12, texture: -10 },
    },
    {
        id: "art-oil",
        name: "油彩浓郁",
        category: "艺术",
        description: "增强色彩密度与局部质感，适合插画和艺术作品。",
        accent: "#c75f54",
        previewFilter: "contrast(1.12) saturate(1.28)",
        settings: { contrast: 14, saturation: 18, vibrance: 22, blacks: -6, clarity: 13, texture: 18, sharpen: 8 },
    },
    {
        id: "art-soft-canvas",
        name: "画布柔光",
        category: "艺术",
        description: "低反差柔光与轻微暖调，保留纸张般的呼吸感。",
        accent: "#cfc6a9",
        previewFilter: "brightness(1.04) contrast(.91) saturate(.9) sepia(.1)",
        settings: { brightness: 4, contrast: -13, highlights: -9, shadows: 8, saturation: -9, temperature: 8, texture: -6, noise: 4 },
    },
    {
        id: "east-jade",
        name: "青绿山岚",
        category: "东方",
        description: "青绿暗部与含蓄暖光，适合山水、国风和东方幻想。",
        accent: "#5f9a89",
        previewFilter: "contrast(1.06) saturate(.94) hue-rotate(7deg)",
        settings: { contrast: 9, highlights: -16, shadows: 9, saturation: -5, temperature: -6, tint: -7, splitTone: { shadowHue: 172, shadowSaturation: 20, highlightHue: 48, highlightSaturation: 10 } },
    },
    {
        id: "east-cinnabar",
        name: "朱砂暮色",
        category: "东方",
        description: "朱砂暖色与深墨黑位，强调东方叙事氛围。",
        accent: "#b65f50",
        previewFilter: "contrast(1.13) saturate(1.04) sepia(.12)",
        settings: { exposure: -3, contrast: 17, highlights: -20, blacks: -11, saturation: 4, temperature: 12, tint: 5, splitTone: { shadowHue: 224, shadowSaturation: 10, highlightHue: 18, highlightSaturation: 24 } },
    },
    {
        id: "fantasy-nebula",
        name: "星雾靛蓝",
        category: "幻想",
        description: "靛蓝阴影与紫色高光塑造轻盈的幻想空间。",
        accent: "#7477c7",
        previewFilter: "contrast(1.1) saturate(1.12) hue-rotate(18deg)",
        settings: { contrast: 12, shadows: -8, vibrance: 18, temperature: -16, tint: 15, splitTone: { shadowHue: 225, shadowSaturation: 28, highlightHue: 292, highlightSaturation: 18 } },
    },
    {
        id: "fantasy-dawn",
        name: "灵境霞光",
        category: "幻想",
        description: "明亮霞色与柔和蓝影，适合梦境和概念设计。",
        accent: "#d18aa6",
        previewFilter: "brightness(1.05) saturate(1.13) hue-rotate(-5deg)",
        settings: { exposure: 5, highlights: -10, shadows: 10, vibrance: 20, temperature: 6, tint: 13, splitTone: { shadowHue: 212, shadowSaturation: 14, highlightHue: 330, highlightSaturation: 22 } },
    },
    {
        id: "retro-film",
        name: "胶片暖棕",
        category: "复古",
        description: "抬起黑位、压低饱和，呈现温暖胶片质感。",
        accent: "#ad8565",
        previewFilter: "contrast(.95) saturate(.83) sepia(.2)",
        settings: { contrast: -5, highlights: -12, shadows: 8, blacks: 14, saturation: -16, temperature: 13, tint: 2, noise: 10, vignette: 8 },
    },
    {
        id: "retro-silver",
        name: "褪色银盐",
        category: "复古",
        description: "低饱和与细颗粒，形成安静的旧时影像。",
        accent: "#9d9a90",
        previewFilter: "contrast(.92) saturate(.55) sepia(.08)",
        settings: { brightness: 2, contrast: -9, highlights: -8, blacks: 18, saturation: -42, temperature: 4, noise: 16, vignette: 10 },
    },
    {
        id: "mono-ink",
        name: "墨阶",
        category: "黑白",
        description: "保留柔和灰阶与深墨层次。",
        accent: "#858783",
        previewFilter: "grayscale(1) contrast(1.08)",
        settings: { saturation: -100, contrast: 10, highlights: -14, shadows: 7, blacks: -8, clarity: 6 },
    },
    {
        id: "mono-silver",
        name: "高反银幕",
        category: "黑白",
        description: "高反差黑白与锐利边缘，适合建筑和海报。",
        accent: "#d5d5cf",
        previewFilter: "grayscale(1) contrast(1.3)",
        settings: { saturation: -100, contrast: 28, highlights: 8, shadows: -18, blacks: -16, clarity: 18, sharpen: 12 },
    },
];

export const QUICK_COLOR_PRESET_IDS = ["quick-natural", "quick-clear", "quick-premium", "quick-cinema", "quick-vivid", "quick-commerce"] as const;
export const QUICK_COLOR_PRESETS = QUICK_COLOR_PRESET_IDS.map((id) => COLOR_PRESETS.find((preset) => preset.id === id)).filter((preset): preset is ColorPreset => Boolean(preset));

export function applyColorPreset(preset: ColorPreset, intensity: number): ColorSettings {
    const strength = Math.min(100, Math.max(0, intensity)) / 100;
    const defaults = createDefaultColorSettings();
    const target = mergeColorSettings(defaults, preset.settings);
    const blended = blendSettings(defaults, target, strength);
    return { ...blended, preset: preset.id, presetIntensity: Math.round(strength * 100) };
}

function blendSettings(base: ColorSettings, target: ColorSettings, amount: number): ColorSettings {
    const mix = (left: number, right: number) => Math.round((left + (right - left) * amount) * 100) / 100;
    const next = createDefaultColorSettings();
    const numericKeys = ["exposure", "brightness", "contrast", "highlights", "shadows", "blacks", "saturation", "vibrance", "temperature", "tint", "sharpen", "clarity", "texture", "noise", "vignette"] as const;
    numericKeys.forEach((key) => {
        next[key] = mix(base[key], target[key]);
    });
    Object.keys(next.hsl).forEach((key) => {
        const channel = key as keyof ColorSettings["hsl"];
        next.hsl[channel] = {
            hue: mix(base.hsl[channel].hue, target.hsl[channel].hue),
            saturation: mix(base.hsl[channel].saturation, target.hsl[channel].saturation),
            lightness: mix(base.hsl[channel].lightness, target.hsl[channel].lightness),
        };
    });
    next.splitTone = {
        shadowHue: target.splitTone.shadowHue,
        shadowSaturation: mix(base.splitTone.shadowSaturation, target.splitTone.shadowSaturation),
        highlightHue: target.splitTone.highlightHue,
        highlightSaturation: mix(base.splitTone.highlightSaturation, target.splitTone.highlightSaturation),
        balance: mix(base.splitTone.balance, target.splitTone.balance),
    };
    return next;
}

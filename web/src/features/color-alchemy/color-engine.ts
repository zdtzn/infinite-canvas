import { COLOR_HSL_CHANNELS, type AnalyzedColor, type ColorAnalysis, type ColorHarmony, type ColorSettings, type ColorValueFormat } from "./types";
import { sampleFilmLut, type FilmLut } from "./film-lut";
import { cloneColorSettings } from "./settings";

const HUE_CENTERS = {
    red: 0,
    orange: 30,
    yellow: 60,
    green: 120,
    cyan: 180,
    blue: 230,
    purple: 280,
    magenta: 325,
} as const;

export function applyColorSettingsToImageData(imageData: ImageData, width: number, height: number, settings: ColorSettings, originX = 0, originY = 0, totalWidth = width, totalHeight = height, lut: FilmLut | null = null) {
    const data = imageData.data;
    const exposure = 2 ** (settings.exposure / 50);
    const contrast = Math.max(0, 1 + settings.contrast / 100);
    const brightness = settings.brightness / 400;
    const temperature = settings.temperature / 850;
    const tint = settings.tint / 1050;
    const saturation = Math.max(0, 1 + settings.saturation / 100);
    const vibrance = settings.vibrance / 100;
    const splitShadow = hslToRgb(settings.splitTone.shadowHue, 0.72, 0.5);
    const splitHighlight = hslToRgb(settings.splitTone.highlightHue, 0.72, 0.5);
    const hasHsl = COLOR_HSL_CHANNELS.some((channel) => {
        const adjustment = settings.hsl[channel];
        return adjustment.hue || adjustment.saturation || adjustment.lightness;
    });
    const hasCurves = Object.values(settings.curves).some((curve) => curve.some(Boolean));
    const lutOutput = lut && settings.lutIntensity > 0 ? new Float32Array(3) : null;

    for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 0) continue;
        let red = data[index] / 255;
        let green = data[index + 1] / 255;
        let blue = data[index + 2] / 255;
        let luminance = rgbLuminance(red, green, blue);

        red = red * exposure + brightness;
        green = green * exposure + brightness;
        blue = blue * exposure + brightness;

        const shadowWeight = (1 - luminance) ** 2;
        const highlightWeight = luminance ** 2;
        const blackWeight = (1 - luminance) ** 4;
        const tonalShift = (settings.shadows / 100) * 0.34 * shadowWeight + (settings.highlights / 100) * 0.34 * highlightWeight + (settings.blacks / 100) * 0.24 * blackWeight;
        red += tonalShift;
        green += tonalShift;
        blue += tonalShift;

        red = (red - 0.5) * contrast + 0.5 + temperature + tint * 0.65;
        green = (green - 0.5) * contrast + 0.5 - tint;
        blue = (blue - 0.5) * contrast + 0.5 - temperature + tint * 0.65;

        luminance = rgbLuminance(red, green, blue);
        const maxChannel = Math.max(red, green, blue);
        const minChannel = Math.min(red, green, blue);
        const currentSaturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
        const vibranceFactor = 1 + vibrance * (1 - currentSaturation) * 0.85;
        const saturationFactor = Math.max(0, saturation * vibranceFactor);
        red = luminance + (red - luminance) * saturationFactor;
        green = luminance + (green - luminance) * saturationFactor;
        blue = luminance + (blue - luminance) * saturationFactor;

        if (hasHsl) {
            const hsl = rgbToHsl(red, green, blue);
            let hueShift = 0;
            let saturationShift = 0;
            let lightnessShift = 0;
            COLOR_HSL_CHANNELS.forEach((channel) => {
                const influence = hueInfluence(hsl[0], HUE_CENTERS[channel]);
                if (!influence) return;
                const adjustment = settings.hsl[channel];
                hueShift += adjustment.hue * 0.45 * influence;
                saturationShift += (adjustment.saturation / 100) * influence;
                lightnessShift += (adjustment.lightness / 100) * 0.45 * influence;
            });
            [red, green, blue] = hslToRgb(normalizeHue(hsl[0] + hueShift), clamp01(hsl[1] + saturationShift), clamp01(hsl[2] + lightnessShift));
        }

        if (hasCurves) {
            const master = curveShift(rgbLuminance(red, green, blue), settings.curves.rgb);
            red += master + curveShift(red, settings.curves.red);
            green += master + curveShift(green, settings.curves.green);
            blue += master + curveShift(blue, settings.curves.blue);
        }

        luminance = clamp01(rgbLuminance(red, green, blue));
        const balance = settings.splitTone.balance / 200;
        const shadowAmount = (settings.splitTone.shadowSaturation / 100) * clamp01(1 - luminance - balance) * 0.28;
        const highlightAmount = (settings.splitTone.highlightSaturation / 100) * clamp01(luminance + balance) * 0.28;
        red = mix(red, splitShadow[0], shadowAmount);
        green = mix(green, splitShadow[1], shadowAmount);
        blue = mix(blue, splitShadow[2], shadowAmount);
        red = mix(red, splitHighlight[0], highlightAmount);
        green = mix(green, splitHighlight[1], highlightAmount);
        blue = mix(blue, splitHighlight[2], highlightAmount);

        if (lut && lutOutput) {
            const lutAmount = settings.lutIntensity / 100;
            const sampled = sampleFilmLut(lut, clamp01(red), clamp01(green), clamp01(blue), lutOutput);
            red = mix(red, sampled[0], lutAmount);
            green = mix(green, sampled[1], lutAmount);
            blue = mix(blue, sampled[2], lutAmount);
        }

        const pixel = index / 4;
        const x = originX + (pixel % width);
        const y = originY + Math.floor(pixel / width);
        if (settings.vignette) {
            const dx = (x / Math.max(1, totalWidth - 1) - 0.5) * 2;
            const dy = (y / Math.max(1, totalHeight - 1) - 0.5) * 2;
            const distance = clamp01((Math.sqrt(dx * dx + dy * dy) - 0.25) / 0.9);
            const vignette = (settings.vignette / 100) * distance * distance * 0.55;
            red *= 1 - vignette;
            green *= 1 - vignette;
            blue *= 1 - vignette;
        }
        if (settings.noise) {
            const noise = (hashNoise(x, y) - 0.5) * (settings.noise / 100) * 0.16;
            red += noise;
            green += noise;
            blue += noise;
        }

        data[index] = Math.round(clamp01(red) * 255);
        data[index + 1] = Math.round(clamp01(green) * 255);
        data[index + 2] = Math.round(clamp01(blue) * 255);
    }

    applyDetailAdjustments(data, width, height, settings);
    return imageData;
}

export function extractColorAnalysis(imageData: ImageData): ColorAnalysis {
    const data = imageData.data;
    const pixelCount = Math.max(1, data.length / 4);
    const sampleStride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 7_000)));
    const bins = new Map<number, { count: number; red: number; green: number; blue: number; saturation: number }>();
    let count = 0;
    let luminanceSum = 0;
    let luminanceSquareSum = 0;
    let saturationSum = 0;
    let temperatureSum = 0;
    let tintSum = 0;

    for (let pixel = 0; pixel < pixelCount; pixel += sampleStride) {
        const index = pixel * 4;
        if (data[index + 3] < 128) continue;
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const normalizedRed = red / 255;
        const normalizedGreen = green / 255;
        const normalizedBlue = blue / 255;
        const luminance = rgbLuminance(normalizedRed, normalizedGreen, normalizedBlue);
        const hsl = rgbToHsl(normalizedRed, normalizedGreen, normalizedBlue);
        const key = ((red >> 5) << 6) | ((green >> 5) << 3) | (blue >> 5);
        const bin = bins.get(key) || { count: 0, red: 0, green: 0, blue: 0, saturation: 0 };
        bin.count += 1;
        bin.red += red;
        bin.green += green;
        bin.blue += blue;
        bin.saturation += hsl[1];
        bins.set(key, bin);
        count += 1;
        luminanceSum += luminance;
        luminanceSquareSum += luminance * luminance;
        saturationSum += hsl[1];
        temperatureSum += (red - blue) / 255;
        tintSum += (red + blue - green * 2) / 510;
    }

    const safeCount = Math.max(1, count);
    const luminance = luminanceSum / safeCount;
    const contrast = Math.sqrt(Math.max(0, luminanceSquareSum / safeCount - luminance * luminance));
    const colors = Array.from(bins.values())
        .sort((left, right) => right.count - left.count)
        .reduce<AnalyzedColor[]>((selected, bin) => {
            const rgb: [number, number, number] = [Math.round(bin.red / bin.count), Math.round(bin.green / bin.count), Math.round(bin.blue / bin.count)];
            if (selected.some((color) => colorDistance(color.rgb, rgb) < 46)) return selected;
            selected.push(toAnalyzedColor(rgb, bin.count / safeCount));
            return selected;
        }, [])
        .slice(0, 6);

    while (colors.length < 3) {
        const fallback = colors[0]?.rgb || [128, 128, 128];
        const hsl = rgbToHsl(fallback[0] / 255, fallback[1] / 255, fallback[2] / 255);
        const shifted = hslToRgb(normalizeHue(hsl[0] + colors.length * 42), hsl[1], clamp01(hsl[2] + (colors.length - 1) * 0.08)).map((value) => Math.round(value * 255)) as [number, number, number];
        colors.push(toAnalyzedColor(shifted, 0));
    }

    const accent = [...colors].sort((left, right) => right.hsl[1] - left.hsl[1])[0] || colors[2];
    return {
        luminance,
        contrast,
        saturation: saturationSum / safeCount,
        temperature: temperatureSum / safeCount,
        tint: tintSum / safeCount,
        mood: describeMood(luminance, contrast, saturationSum / safeCount, temperatureSum / safeCount),
        palette: {
            primary: colors[0],
            secondary: colors[1],
            accent,
            colors,
        },
    };
}

export function recommendColorSettings(analysis: ColorAnalysis, current: ColorSettings) {
    const next = cloneColorSettings(current);
    const notes: string[] = [];
    if (analysis.luminance < 0.38) {
        next.exposure = Math.max(next.exposure, 9);
        next.shadows = Math.max(next.shadows, 18);
        notes.push("提亮暗部层次");
    } else if (analysis.luminance > 0.68) {
        next.exposure = Math.min(next.exposure, -7);
        next.highlights = Math.min(next.highlights, -18);
        notes.push("收束明亮区域");
    } else {
        next.highlights = Math.min(next.highlights, -10);
        next.shadows = Math.max(next.shadows, 8);
        notes.push("平衡高光与阴影");
    }
    if (analysis.contrast < 0.18) {
        next.contrast = Math.max(next.contrast, 12);
        next.clarity = Math.max(next.clarity, 7);
        notes.push("建立画面层次");
    } else if (analysis.contrast > 0.31) {
        next.contrast = Math.min(next.contrast, -6);
        notes.push("缓和强烈反差");
    }
    if (analysis.saturation < 0.28) {
        next.vibrance = Math.max(next.vibrance, 18);
        notes.push("唤醒低饱和色彩");
    } else if (analysis.saturation > 0.65) {
        next.saturation = Math.min(next.saturation, -9);
        notes.push("控制色彩密度");
    } else {
        next.vibrance = Math.max(next.vibrance, 8);
    }
    next.temperature = clamp(Math.round(-analysis.temperature * 22), -14, 14);
    next.tint = clamp(Math.round(-analysis.tint * 18), -10, 10);
    next.preset = null;
    return { settings: next, notes };
}

export function deriveBorrowedColorSettings(source: ColorAnalysis, reference: ColorAnalysis, current: ColorSettings) {
    const next = cloneColorSettings(current);
    next.temperature = clamp(Math.round((reference.temperature - source.temperature) * 72), -100, 100);
    next.tint = clamp(Math.round((reference.tint - source.tint) * 66), -100, 100);
    next.vibrance = clamp(Math.round((reference.saturation - source.saturation) * 54), -100, 100);
    next.contrast = clamp(Math.round((reference.contrast - source.contrast) * 90), -100, 100);
    next.exposure = clamp(Math.round((reference.luminance - source.luminance) * 38), -100, 100);
    next.splitTone.shadowHue = reference.palette.secondary.hsl[0];
    next.splitTone.shadowSaturation = clamp(Math.round(reference.palette.secondary.hsl[1] * 24), 0, 34);
    next.splitTone.highlightHue = reference.palette.accent.hsl[0];
    next.splitTone.highlightSaturation = clamp(Math.round(reference.palette.accent.hsl[1] * 20), 0, 30);
    next.preset = null;
    return next;
}

export function buildColorHarmonies(color: AnalyzedColor): ColorHarmony[] {
    const [hue, saturation, lightness] = color.hsl;
    const create = (label: string, offsets: number[]) => ({
        label,
        colors: offsets.map((offset) => hslAnalyzedColor(normalizeHue(hue + offset), saturation, lightness)),
    });
    return [create("类似色", [-30, 0, 30]), create("互补色", [0, 180]), create("三角色", [0, 120, 240]), create("分裂互补", [0, 150, 210])];
}

export function formatColorRgb(color: AnalyzedColor) {
    return `rgb(${color.rgb.join(", ")})`;
}

export function formatColorHsl(color: AnalyzedColor) {
    return `hsl(${Math.round(color.hsl[0])}, ${Math.round(color.hsl[1] * 100)}%, ${Math.round(color.hsl[2] * 100)}%)`;
}

export function formatColorValue(color: AnalyzedColor, format: ColorValueFormat) {
    if (format === "rgb") return formatColorRgb(color);
    if (format === "hsl") return formatColorHsl(color);
    return color.hex;
}

export function analyzedColorFromRgb(rgb: [number, number, number]): AnalyzedColor {
    return toAnalyzedColor(rgb, 0);
}

function applyDetailAdjustments(data: Uint8ClampedArray, width: number, height: number, settings: ColorSettings) {
    if (width < 3 || height < 3 || (!settings.sharpen && !settings.clarity && !settings.texture)) return;
    const source = new Uint8ClampedArray(data);
    const sharpen = settings.sharpen / 100;
    const clarity = settings.clarity / 100;
    const texture = settings.texture / 100;
    for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
            const index = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
                const center = source[index + channel];
                const average = (source[index - 4 + channel] + source[index + 4 + channel] + source[index - width * 4 + channel] + source[index + width * 4 + channel]) / 4;
                const detail = center - average;
                const luminanceWeight = 1 - Math.abs(rgbLuminance(source[index] / 255, source[index + 1] / 255, source[index + 2] / 255) - 0.5) * 1.35;
                const amount = sharpen * 0.82 + texture * 0.32 + clarity * 0.4 * Math.max(0, luminanceWeight);
                data[index + channel] = Math.round(clamp(center + detail * amount, 0, 255));
            }
        }
    }
}

function curveShift(value: number, curve: [number, number, number]) {
    const shadows = ((1 - value) ** 2 * curve[0]) / 400;
    const midtones = (4 * value * (1 - value) * curve[1]) / 400;
    const highlights = (value ** 2 * curve[2]) / 400;
    return shadows + midtones + highlights;
}

function hueInfluence(hue: number, center: number) {
    const distance = Math.abs(((hue - center + 540) % 360) - 180);
    return distance >= 48 ? 0 : 1 - distance / 48;
}

function toAnalyzedColor(rgb: [number, number, number], weight: number): AnalyzedColor {
    const hsl = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    return { rgb, hsl, hex: rgbToHex(rgb), weight };
}

function hslAnalyzedColor(hue: number, saturation: number, lightness: number) {
    const rgb = hslToRgb(hue, saturation, lightness).map((value) => Math.round(value * 255)) as [number, number, number];
    return toAnalyzedColor(rgb, 0);
}

function describeMood(luminance: number, contrast: number, saturation: number, temperature: number) {
    const light = luminance < 0.38 ? "幽深" : luminance > 0.67 ? "明净" : "平衡";
    const tone = temperature > 0.06 ? "暖韵" : temperature < -0.06 ? "冷韵" : "中性色温";
    const density = saturation > 0.55 ? "浓彩" : saturation < 0.24 ? "素雅" : contrast > 0.28 ? "高反差" : "柔和";
    return `${light} · ${tone} · ${density}`;
}

function rgbToHex(rgb: [number, number, number]) {
    return `#${rgb.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function colorDistance(left: [number, number, number], right: [number, number, number]) {
    return Math.sqrt((left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2);
}

function rgbLuminance(red: number, green: number, blue: number) {
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
    red = clamp01(red);
    green = clamp01(green);
    blue = clamp01(blue);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if (max === min) return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue *= 60;
    return [normalizeHue(hue), clamp01(saturation), clamp01(lightness)];
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    hue = normalizeHue(hue) / 360;
    saturation = clamp01(saturation);
    lightness = clamp01(lightness);
    if (!saturation) return [lightness, lightness, lightness];
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const channel = (offset: number) => {
        let value = hue + offset;
        if (value < 0) value += 1;
        if (value > 1) value -= 1;
        if (value < 1 / 6) return p + (q - p) * 6 * value;
        if (value < 1 / 2) return q;
        if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
        return p;
    };
    return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

function hashNoise(x: number, y: number) {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return value - Math.floor(value);
}

function normalizeHue(value: number) {
    return ((value % 360) + 360) % 360;
}

function mix(left: number, right: number, amount: number) {
    return left + (right - left) * clamp01(amount);
}

function clamp01(value: number) {
    return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

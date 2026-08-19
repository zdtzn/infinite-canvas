import { COLOR_CURVE_CHANNELS, COLOR_HSL_CHANNELS, type ColorCurve, type ColorCurvePoint, type ColorSettings, type ColorSettingsPatch, type HslAdjustment } from "./types";

const ZERO_HSL: HslAdjustment = { hue: 0, saturation: 0, lightness: 0 };
const MAX_CURVE_POINTS = 16;
const LEGACY_CURVE_SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const;

export function createDefaultColorCurve(): ColorCurve {
    return [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
    ];
}

export function createDefaultColorSettings(): ColorSettings {
    return {
        exposure: 0,
        brightness: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        blacks: 0,
        saturation: 0,
        vibrance: 0,
        temperature: 0,
        tint: 0,
        hsl: Object.fromEntries(COLOR_HSL_CHANNELS.map((channel) => [channel, { ...ZERO_HSL }])) as ColorSettings["hsl"],
        curves: Object.fromEntries(COLOR_CURVE_CHANNELS.map((channel) => [channel, createDefaultColorCurve()])) as ColorSettings["curves"],
        splitTone: {
            shadowHue: 220,
            shadowSaturation: 0,
            highlightHue: 40,
            highlightSaturation: 0,
            balance: 0,
        },
        sharpen: 0,
        clarity: 0,
        texture: 0,
        noise: 0,
        vignette: 0,
        preset: null,
        presetIntensity: 100,
        lutId: null,
        lutIntensity: 100,
    };
}

export function mergeColorSettings(settings: ColorSettings, patch: ColorSettingsPatch): ColorSettings {
    const next: ColorSettings = {
        ...settings,
        ...patch,
        hsl: { ...settings.hsl },
        curves: { ...settings.curves },
        splitTone: { ...settings.splitTone, ...patch.splitTone },
    };

    if (patch.hsl) {
        COLOR_HSL_CHANNELS.forEach((channel) => {
            next.hsl[channel] = { ...settings.hsl[channel], ...patch.hsl?.[channel] };
        });
    }
    if (patch.curves) {
        COLOR_CURVE_CHANNELS.forEach((channel) => {
            const curve = patch.curves?.[channel];
            next.curves[channel] = normalizeCurve(curve || settings.curves[channel]);
        });
    }

    return normalizeColorSettings(next);
}

export function normalizeColorSettings(value: unknown): ColorSettings {
    const defaults = createDefaultColorSettings();
    if (!value || typeof value !== "object") return defaults;
    const data = value as Partial<ColorSettings>;
    const next = { ...defaults };
    const ranges: Record<keyof Omit<ColorSettings, "hsl" | "curves" | "splitTone" | "preset" | "lutId">, [number, number]> = {
        exposure: [-100, 100],
        brightness: [-100, 100],
        contrast: [-100, 100],
        highlights: [-100, 100],
        shadows: [-100, 100],
        blacks: [-100, 100],
        saturation: [-100, 100],
        vibrance: [-100, 100],
        temperature: [-100, 100],
        tint: [-100, 100],
        sharpen: [0, 100],
        clarity: [-100, 100],
        texture: [-100, 100],
        noise: [0, 100],
        vignette: [-100, 100],
        presetIntensity: [0, 100],
        lutIntensity: [0, 100],
    };

    Object.entries(ranges).forEach(([key, range]) => {
        next[key as keyof typeof ranges] = clampNumber(data[key as keyof ColorSettings], range[0], range[1], defaults[key as keyof typeof ranges]) as never;
    });
    next.preset = typeof data.preset === "string" && data.preset ? data.preset : null;
    next.lutId = typeof data.lutId === "string" && data.lutId ? data.lutId : null;
    next.hsl = { ...defaults.hsl };
    COLOR_HSL_CHANNELS.forEach((channel) => {
        const source = data.hsl?.[channel];
        next.hsl[channel] = {
            hue: clampNumber(source?.hue, -100, 100, 0),
            saturation: clampNumber(source?.saturation, -100, 100, 0),
            lightness: clampNumber(source?.lightness, -100, 100, 0),
        };
    });
    next.curves = { ...defaults.curves };
    COLOR_CURVE_CHANNELS.forEach((channel) => {
        next.curves[channel] = normalizeCurve(data.curves?.[channel]);
    });
    next.splitTone = {
        shadowHue: clampNumber(data.splitTone?.shadowHue, 0, 360, defaults.splitTone.shadowHue),
        shadowSaturation: clampNumber(data.splitTone?.shadowSaturation, 0, 100, 0),
        highlightHue: clampNumber(data.splitTone?.highlightHue, 0, 360, defaults.splitTone.highlightHue),
        highlightSaturation: clampNumber(data.splitTone?.highlightSaturation, 0, 100, 0),
        balance: clampNumber(data.splitTone?.balance, -100, 100, 0),
    };
    return next;
}

export function cloneColorSettings(settings: ColorSettings) {
    return normalizeColorSettings(settings);
}

export function colorSettingsEqual(left: ColorSettings, right: ColorSettings) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCurve(value: unknown): ColorCurve {
    if (isLegacyCurve(value)) return migrateLegacyCurve(value);
    if (!Array.isArray(value)) return createDefaultColorCurve();

    const points = value
        .slice(0, MAX_CURVE_POINTS)
        .map(normalizeCurvePoint)
        .filter((point): point is ColorCurvePoint => Boolean(point))
        .sort((left, right) => left.x - right.x);
    if (!points.length) return createDefaultColorCurve();

    const unique: ColorCurve = [];
    for (const point of points) {
        const previous = unique.at(-1);
        if (previous && Math.abs(previous.x - point.x) < 0.001) previous.y = point.y;
        else unique.push(point);
    }

    if (unique[0].x > 0.001) unique.unshift({ x: 0, y: 0 });
    else unique[0].x = 0;
    if (unique.at(-1)!.x < 0.999) unique.push({ x: 1, y: 1 });
    else unique[unique.length - 1].x = 1;
    return unique;
}

function normalizeCurvePoint(value: unknown): ColorCurvePoint | null {
    if (!value || typeof value !== "object") return null;
    const point = value as Partial<ColorCurvePoint>;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: roundCurveValue(Math.min(1, Math.max(0, x))), y: roundCurveValue(Math.min(1, Math.max(0, y))) };
}

function isLegacyCurve(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
}

function migrateLegacyCurve(curve: [number, number, number]): ColorCurve {
    const normalized = curve.map((value) => Math.min(100, Math.max(-100, Number(value)))) as [number, number, number];
    if (normalized.every((value) => value === 0)) return createDefaultColorCurve();
    return LEGACY_CURVE_SAMPLES.map((x) => ({
        x,
        y: roundCurveValue(Math.min(1, Math.max(0, x + legacyCurveShift(x, normalized)))),
    }));
}

function legacyCurveShift(value: number, curve: [number, number, number]) {
    return (((1 - value) ** 2 * curve[0] + 4 * value * (1 - value) * curve[1] + value ** 2 * curve[2]) / 400);
}

function roundCurveValue(value: number) {
    return Math.round(value * 10_000) / 10_000;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

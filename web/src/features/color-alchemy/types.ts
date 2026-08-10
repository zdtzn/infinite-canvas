export const COLOR_HSL_CHANNELS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"] as const;
export const COLOR_CURVE_CHANNELS = ["rgb", "red", "green", "blue"] as const;
export const COLOR_PRESET_CATEGORIES = ["电影", "摄影", "艺术", "东方", "幻想", "复古", "黑白"] as const;

export type ColorHslChannel = (typeof COLOR_HSL_CHANNELS)[number];
export type ColorCurveChannel = (typeof COLOR_CURVE_CHANNELS)[number];
export type ColorPresetCategory = (typeof COLOR_PRESET_CATEGORIES)[number];
export type ColorCurve = [number, number, number];

export type HslAdjustment = {
    hue: number;
    saturation: number;
    lightness: number;
};

export type ColorSettings = {
    exposure: number;
    brightness: number;
    contrast: number;
    highlights: number;
    shadows: number;
    blacks: number;
    saturation: number;
    vibrance: number;
    temperature: number;
    tint: number;
    hsl: Record<ColorHslChannel, HslAdjustment>;
    curves: Record<ColorCurveChannel, ColorCurve>;
    splitTone: {
        shadowHue: number;
        shadowSaturation: number;
        highlightHue: number;
        highlightSaturation: number;
        balance: number;
    };
    sharpen: number;
    clarity: number;
    texture: number;
    noise: number;
    vignette: number;
    preset: string | null;
    presetIntensity: number;
};

export type ColorSettingsPatch = Partial<Omit<ColorSettings, "hsl" | "curves" | "splitTone">> & {
    hsl?: Partial<Record<ColorHslChannel, Partial<HslAdjustment>>>;
    curves?: Partial<Record<ColorCurveChannel, Partial<ColorCurve> | ColorCurve>>;
    splitTone?: Partial<ColorSettings["splitTone"]>;
};

export type AnalyzedColor = {
    hex: string;
    rgb: [number, number, number];
    hsl: [number, number, number];
    weight: number;
};

export type ColorPalette = {
    primary: AnalyzedColor;
    secondary: AnalyzedColor;
    accent: AnalyzedColor;
    colors: AnalyzedColor[];
};

export type ColorAnalysis = {
    luminance: number;
    contrast: number;
    saturation: number;
    temperature: number;
    tint: number;
    mood: string;
    palette: ColorPalette;
};

export type ColorHarmony = {
    label: string;
    colors: AnalyzedColor[];
};

export type ColorAlchemyOrigin = {
    route: string;
    projectId?: string;
    nodeId?: string;
};

export type ColorAlchemySource = {
    key: string;
    title: string;
    url: string;
    storageKey?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    origin?: ColorAlchemyOrigin;
};

export type ColorAlchemyReference = ColorAlchemySource & {
    analysis?: ColorAnalysis;
};

export type ColorAlchemyDocument = {
    id: string;
    source: ColorAlchemySource;
    reference?: ColorAlchemyReference;
    settings: ColorSettings;
    history: ColorSettings[];
    historyIndex: number;
    analysis?: ColorAnalysis;
    createdAt: string;
    updatedAt: string;
};

export type ColorPreset = {
    id: string;
    name: string;
    category: ColorPresetCategory;
    description: string;
    accent: string;
    previewFilter: string;
    settings: ColorSettingsPatch;
};

export type ColorExportFormat = "png" | "jpeg" | "webp";
export type ColorValueFormat = "hex" | "rgb" | "hsl";

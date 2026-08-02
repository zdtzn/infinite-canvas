import { normalizeImageSizeSelection } from "@/stores/use-config-store";

const RESOLUTION_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 3840,
    standard: 1024,
    hd: 2048,
};
const RESOLUTION_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DIMENSION_STEP = 16;
const MAX_EDGE = 3840;
const MAX_RATIO = 3;
const DEFAULT_MIN_PIXELS = 262_144;
const DEFAULT_MAX_PIXELS = 14_745_600;
const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const LEGACY_GPT_IMAGE_SIZES: Record<string, string> = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
};

type ImageSizeConstraints = {
    minPixels: number;
    maxPixels: number;
};

export function resolveImageRequestSize(resolution: string | undefined, size: string, model = "") {
    const value = normalizeImageSizeSelection(size);
    if (isLegacyGptImageModel(model)) return resolveLegacyGptImageSize(value);
    const constraints = isGptImage2Model(model) ? { minPixels: GPT_IMAGE_2_MIN_PIXELS, maxPixels: GPT_IMAGE_2_MAX_PIXELS } : { minPixels: DEFAULT_MIN_PIXELS, maxPixels: DEFAULT_MAX_PIXELS };
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height, constraints);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (!value.includes(":")) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    return fitImageRatio(normalizeResolution(resolution), value, constraints);
}

function resolveLegacyGptImageSize(value: string) {
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        const explicitSize = `${dimensions.width}x${dimensions.height}`;
        if (Object.values(LEGACY_GPT_IMAGE_SIZES).includes(explicitSize)) return explicitSize;
        throw new Error("旧版 GPT Image 仅支持 1024x1024、1536x1024 或 1024x1536");
    }
    const ratio = parseImageRatio(value);
    const divisor = greatestCommonDivisor(ratio.width, ratio.height);
    const fixedSize = LEGACY_GPT_IMAGE_SIZES[`${ratio.width / divisor}:${ratio.height / divisor}`];
    if (!fixedSize) throw new Error("旧版 GPT Image 仅支持 1:1、3:2 或 2:3");
    return fixedSize;
}

function fitImageRatio(resolution: string, ratio: string, constraints: ImageSizeConstraints) {
    const parsedRatio = parseImageRatio(ratio);
    const divisor = greatestCommonDivisor(parsedRatio.width, parsedRatio.height);
    const ratioWidth = parsedRatio.width / divisor;
    const ratioHeight = parsedRatio.height / divisor;
    const ratioPixelUnit = ratioWidth * ratioHeight * DIMENSION_STEP * DIMENSION_STEP;
    const requestedLongSide = RESOLUTION_BASE[resolution] || RESOLUTION_BASE.low;
    const desiredScale = Math.max(1, Math.round(requestedLongSide / (Math.max(ratioWidth, ratioHeight) * DIMENSION_STEP)));
    const minScale = Math.ceil(Math.sqrt(constraints.minPixels / ratioPixelUnit));
    const maxScale = Math.min(Math.floor(Math.sqrt(constraints.maxPixels / ratioPixelUnit)), Math.floor(MAX_EDGE / (Math.max(ratioWidth, ratioHeight) * DIMENSION_STEP)));
    if (minScale > maxScale) throw new Error("当前图像比例无法满足模型尺寸约束，请调整构图比例");
    const scale = Math.min(maxScale, Math.max(minScale, desiredScale));
    const width = ratioWidth * DIMENSION_STEP * scale;
    const height = ratioHeight * DIMENSION_STEP * scale;
    validateImageSize(width, height, constraints);
    return `${width}x${height}`;
}

function normalizeResolution(resolution: string | undefined) {
    const value = String(resolution || "low")
        .trim()
        .toLowerCase();
    if (!value || value === "auto") return "low";
    const normalized = RESOLUTION_ALIASES[value] || value;
    return RESOLUTION_BASE[normalized] ? normalized : "low";
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function parseImageRatio(value: string) {
    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("图像比例必须是正整数，例如 9:16");
    if (Math.max(width, height) / Math.min(width, height) > MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width, height };
}

function validateImageSize(width: number, height: number, constraints: ImageSizeConstraints) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % DIMENSION_STEP !== 0 || height % DIMENSION_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < constraints.minPixels || pixels > constraints.maxPixels) throw new Error(`图像总像素需在 ${constraints.minPixels} 到 ${constraints.maxPixels} 之间，请调整尺寸`);
}

function isGptImage2Model(model: string) {
    return model.toLowerCase().split("::").at(-1)?.trim() === "gpt-image-2";
}

function isLegacyGptImageModel(model: string) {
    const name = model.toLowerCase().split("::").at(-1)?.trim() || "";
    return /^gpt-image-1(?:$|[.-])/.test(name);
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

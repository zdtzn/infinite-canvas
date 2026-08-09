import { Buffer } from "node:buffer";

import { resolveDragonImageSize } from "./dragon-image";
import { detectImageMimeFromBytes, isAllowedImageMimeType } from "./image-mime";

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 3840,
    standard: 1024,
    hd: 2048,
};
const DIMENSION_STEP = 16;
const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MAX_RATIO = 3;
const LEGACY_GPT_IMAGE_SIZES: Record<string, string> = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
};

type OpenAiImageRequestOptionsInput = {
    count: number;
    quality?: string;
    outputFormat?: string;
    size?: string;
    background?: string;
    responseFormat?: "b64_json" | null;
};

export function imageResponseItems(payload: unknown): Array<Record<string, unknown>> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const record = payload as Record<string, unknown>;
    let emptyItems: Array<Record<string, unknown>> | undefined;
    for (const key of ["data", "images", "results"]) {
        const value = record[key];
        if (!Array.isArray(value)) continue;
        const items = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        if (items.length) return items;
        emptyItems ??= items;
    }
    return emptyItems || [];
}

export function normalizeImageResponseValue(value: unknown, fallbackMimeType: string) {
    const normalized = normalizeImageResponseCandidate(value, fallbackMimeType, 0);
    if (!normalized) throw new Error("上游返回的图片数据无法识别");
    return normalized;
}

export function imageResponseItemValue(item: Record<string, unknown>, fallbackMimeType: string) {
    const candidates = [item.b64_json, item.url, item.image_url, item.imageUrl, item.file_url, item.fileUrl, item.download_url, item.downloadUrl];
    let firstError: unknown;
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        try {
            return normalizeImageResponseValue(candidate, fallbackMimeType);
        } catch (error) {
            firstError ??= error;
        }
    }
    if (firstError) throw firstError;
    return "";
}

function normalizeImageResponseCandidate(value: unknown, fallbackMimeType: string, depth: number): string | undefined {
    if (depth > 5 || value === undefined || value === null) return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const normalized = normalizeImageResponseCandidate(item, fallbackMimeType, depth + 1);
            if (normalized) return normalized;
        }
        return undefined;
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        for (const key of [
            "b64_json",
            "url",
            "image_url",
            "imageUrl",
            "file_url",
            "fileUrl",
            "download_url",
            "downloadUrl",
            "base64",
            "data",
            "images",
            "results",
            "result",
            "output",
        ]) {
            const normalized = normalizeImageResponseCandidate(record[key], fallbackMimeType, depth + 1);
            if (normalized) return normalized;
        }
        return undefined;
    }
    if (typeof value !== "string") return undefined;

    const input = value.trim();
    if (!input) return undefined;
    if ((input.startsWith('"') && input.endsWith('"')) || ((input.startsWith("{") || input.startsWith("[")) && (input.endsWith("}") || input.endsWith("]")))) {
        try {
            const normalized = normalizeImageResponseCandidate(JSON.parse(input), fallbackMimeType, depth + 1);
            if (normalized) return normalized;
        } catch {
            // Continue with direct URL or Base64 detection below.
        }
    }

    if (/^https?:\/\//i.test(input)) {
        try {
            const url = new URL(input);
            if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) return url.toString();
        } catch {
            return undefined;
        }
    }

    if (/^(?:data|https?)%3a/i.test(input)) {
        try {
            return normalizeImageResponseCandidate(decodeURIComponent(input), fallbackMimeType, depth + 1);
        } catch {
            return undefined;
        }
    }

    if (/^data:/i.test(input)) {
        const commaIndex = input.indexOf(",");
        if (commaIndex < 0) return undefined;
        const metadata = input.slice(5, commaIndex).split(";").map((part) => part.trim());
        if (!metadata.some((part) => part.toLowerCase() === "base64")) return undefined;
        const payload = input.slice(commaIndex + 1).trim();
        if (/^data:/i.test(payload)) return normalizeImageResponseCandidate(payload, fallbackMimeType, depth + 1);
        return normalizedImageDataUrl(payload, metadata[0] || fallbackMimeType);
    }

    return normalizedImageDataUrl(input, fallbackMimeType);
}

function normalizedImageDataUrl(value: string, fallbackMimeType: string) {
    const base64 = value.replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/_=-]+$/.test(base64)) return undefined;
    const sample = Buffer.from(base64.slice(0, 256), "base64");
    const detectedMimeType = detectImageMimeFromBytes(sample);
    const fallback = fallbackMimeType.trim().toLowerCase();
    const mimeType = detectedMimeType || (isAllowedImageMimeType(fallback) ? fallback : "");
    if (!mimeType || !detectedMimeType) return undefined;
    return `data:${mimeType};base64,${base64}`;
}

export function usesJsonReferenceGeneration(baseUrl: string, model: string, referenceCount: number, hasMask: boolean) {
    if (!referenceCount || hasMask) return false;
    const normalizedModel = model.toLowerCase();
    if (normalizedModel.includes("seedream") || normalizedModel.includes("doubao-seedream")) return true;
    try {
        return new URL(baseUrl).hostname.toLowerCase() === "ark.cn-beijing.volces.com";
    } catch {
        return false;
    }
}

/** Keep the common Images API payload compatible with strict OpenAI-style gateways. */
export function buildOpenAiImageRequestOptions({ count, quality, outputFormat, size, background, responseFormat = "b64_json" }: OpenAiImageRequestOptionsInput) {
    return {
        ...(count > 1 ? { n: count } : {}),
        ...(quality ? { quality } : {}),
        ...(outputFormat ? { output_format: outputFormat } : {}),
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
    };
}

/** Convert the workbench's ratio presets to OpenAI-compatible pixel dimensions. */
export function resolveOpenAiImageSize(size?: string, quality?: string, model = "", baseUrl = "") {
    const dragonSize = resolveDragonImageSize(size, quality, model, baseUrl);
    if (dragonSize) return dragonSize;
    const requestedValue = String(size || "").trim();
    if (!requestedValue) return undefined;
    const value = requestedValue.toLowerCase() === "auto" ? "1:1" : requestedValue;
    if (isLegacyGptImageModel(model)) return resolveLegacyGptImageSize(value);
    const explicitDimensions = value.match(/^(\d+)x(\d+)$/i);
    if (explicitDimensions) {
        const width = Number(explicitDimensions[1]);
        const height = Number(explicitDimensions[2]);
        if (isGptImage2Model(model)) validateGptImage2Size(width, height);
        return `${width}x${height}`;
    }

    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) return value;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return value;

    const requestedLongSide = QUALITY_BASE[String(quality || "").trim().toLowerCase()] || QUALITY_BASE.low;
    const divisor = greatestCommonDivisor(width, height);
    const ratioWidth = width / divisor;
    const ratioHeight = height / divisor;
    const desiredScale = Math.max(1, Math.round(requestedLongSide / (Math.max(ratioWidth, ratioHeight) * DIMENSION_STEP)));
    const scale = isGptImage2Model(model) ? constrainedGptImage2Scale(ratioWidth, ratioHeight, desiredScale) : desiredScale;
    return `${ratioWidth * DIMENSION_STEP * scale}x${ratioHeight * DIMENSION_STEP * scale}`;
}

function resolveLegacyGptImageSize(value: string) {
    const explicitDimensions = value.match(/^(\d+)x(\d+)$/i);
    if (explicitDimensions) {
        const explicitSize = `${Number(explicitDimensions[1])}x${Number(explicitDimensions[2])}`;
        if (Object.values(LEGACY_GPT_IMAGE_SIZES).includes(explicitSize)) return explicitSize;
        throw new Error("Legacy GPT Image models only support 1024x1024, 1536x1024, or 1024x1536");
    }
    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) throw new Error("Legacy GPT Image models only support 1:1, 3:2, or 2:3");
    const width = Number(match[1]);
    const height = Number(match[2]);
    const divisor = greatestCommonDivisor(width, height);
    const fixedSize = LEGACY_GPT_IMAGE_SIZES[`${width / divisor}:${height / divisor}`];
    if (!fixedSize) throw new Error("Legacy GPT Image models only support 1:1, 3:2, or 2:3");
    return fixedSize;
}

function constrainedGptImage2Scale(ratioWidth: number, ratioHeight: number, desiredScale: number) {
    if (Math.max(ratioWidth, ratioHeight) / Math.min(ratioWidth, ratioHeight) > GPT_IMAGE_2_MAX_RATIO) throw new Error("GPT Image 2 aspect ratio must not exceed 3:1");
    const ratioPixelUnit = ratioWidth * ratioHeight * DIMENSION_STEP * DIMENSION_STEP;
    const minScale = Math.ceil(Math.sqrt(GPT_IMAGE_2_MIN_PIXELS / ratioPixelUnit));
    const maxScale = Math.min(Math.floor(Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / ratioPixelUnit)), Math.floor(GPT_IMAGE_2_MAX_EDGE / (Math.max(ratioWidth, ratioHeight) * DIMENSION_STEP)));
    if (minScale > maxScale) throw new Error("GPT Image 2 aspect ratio cannot satisfy the documented size limits");
    return Math.min(maxScale, Math.max(minScale, desiredScale));
}

function validateGptImage2Size(width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("GPT Image 2 size must use positive integer dimensions");
    if (width % DIMENSION_STEP !== 0 || height % DIMENSION_STEP !== 0) throw new Error("GPT Image 2 dimensions must be multiples of 16");
    if (Math.max(width, height) > GPT_IMAGE_2_MAX_EDGE) throw new Error("GPT Image 2 longest edge must not exceed 3840 pixels");
    if (Math.max(width, height) / Math.min(width, height) > GPT_IMAGE_2_MAX_RATIO) throw new Error("GPT Image 2 aspect ratio must not exceed 3:1");
    const pixels = width * height;
    if (pixels < GPT_IMAGE_2_MIN_PIXELS || pixels > GPT_IMAGE_2_MAX_PIXELS) throw new Error(`GPT Image 2 size must contain between ${GPT_IMAGE_2_MIN_PIXELS} and ${GPT_IMAGE_2_MAX_PIXELS} pixels`);
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

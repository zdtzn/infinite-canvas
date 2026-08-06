const SADAI_IMAGE_API_HOST = "api.sadai.top";
const SADAI_ASPECT_RATIOS = new Set(["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"]);

const SADAI_RESOLUTION_MAP: Record<string, string> = {
    low: "1k",
    medium: "2k",
    high: "4k",
    standard: "1k",
    hd: "2k",
    "1k": "1k",
    "2k": "2k",
    "4k": "4k",
};

const SADAI_QUALITY_MAP: Record<string, string> = {
    low: "low",
    medium: "medium",
    high: "high",
    standard: "medium",
    hd: "high",
};

type SadaiImageRequestOptionsInput = {
    count: number;
    size?: string;
    outputResolution?: string;
    generationQuality?: string;
    references: string[];
};

export function isSadaiImage2Channel(baseUrl: string, model: string) {
    try {
        return new URL(baseUrl).hostname.toLowerCase() === SADAI_IMAGE_API_HOST && model.trim().toLowerCase() === "gpt-image-2";
    } catch {
        return false;
    }
}

export function buildSadaiImageRequestOptions({ count, size, outputResolution, generationQuality, references }: SadaiImageRequestOptionsInput) {
    const aspectRatio = resolveSadaiAspectRatio(size);
    const resolution = SADAI_RESOLUTION_MAP[String(outputResolution || "").trim().toLowerCase()];
    const quality = SADAI_QUALITY_MAP[String(generationQuality || "").trim().toLowerCase()];
    return {
        n: Math.max(1, Math.floor(count) || 1),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(quality ? { quality } : {}),
        response_format: "url",
        ...(references.length ? { images: [...references] } : {}),
    };
}

function resolveSadaiAspectRatio(size?: string) {
    const requestedValue = String(size || "").trim().toLowerCase();
    if (!requestedValue) return undefined;
    const value = requestedValue === "auto" ? "1:1" : requestedValue;
    const match = value.match(/^(\d+)\s*[:x]\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return undefined;
    const requestedRatio = `${width}:${height}`;
    if (SADAI_ASPECT_RATIOS.has(requestedRatio)) return requestedRatio;
    const divisor = greatestCommonDivisor(width, height);
    const aspectRatio = `${width / divisor}:${height / divisor}`;
    if (!SADAI_ASPECT_RATIOS.has(aspectRatio)) throw new Error(`SADAI Image2 does not support aspect ratio ${aspectRatio}`);
    return aspectRatio;
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

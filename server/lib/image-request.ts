const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 3840,
    standard: 1024,
    hd: 2048,
};
const DIMENSION_STEP = 16;

type OpenAiImageRequestOptionsInput = {
    count: number;
    quality?: string;
    outputFormat?: string;
    size?: string;
    background?: string;
};

/** Keep the common Images API payload compatible with strict OpenAI-style gateways. */
export function buildOpenAiImageRequestOptions({ count, quality, outputFormat, size, background }: OpenAiImageRequestOptionsInput) {
    return {
        ...(count > 1 ? { n: count } : {}),
        ...(quality ? { quality } : {}),
        ...(outputFormat ? { output_format: outputFormat } : {}),
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
        response_format: "b64_json",
    };
}

/** Convert the workbench's ratio presets to OpenAI-compatible pixel dimensions. */
export function resolveOpenAiImageSize(size?: string, quality?: string) {
    const value = String(size || "").trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    if (/^\d+x\d+$/i.test(value)) return value.toLowerCase();

    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) return value;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return value;

    const requestedLongSide = QUALITY_BASE[String(quality || "").trim().toLowerCase()] || QUALITY_BASE.low;
    const divisor = greatestCommonDivisor(width, height);
    const ratioWidth = width / divisor;
    const ratioHeight = height / divisor;
    const scale = Math.max(1, Math.round(requestedLongSide / (Math.max(ratioWidth, ratioHeight) * DIMENSION_STEP)));
    return `${ratioWidth * DIMENSION_STEP * scale}x${ratioHeight * DIMENSION_STEP * scale}`;
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

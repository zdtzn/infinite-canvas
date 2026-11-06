const SADAI_IMAGE_API_HOST = "api.sadai.top";
const SADAI_STANDARD_API_ORIGINS = new Set(["https://verysadai.com", "https://sadai.cc", "https://sadai.top"]);
const SADAI_IMAGE_25_MODELS = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
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

export function sadaiImageBaseUrl(baseUrl: string, model: string) {
    if (!SADAI_IMAGE_25_MODELS.has(model.trim().toLowerCase())) return baseUrl;
    try {
        const { origin } = new URL(baseUrl);
        if (!SADAI_STANDARD_API_ORIGINS.has(origin) || !["", "/", "/v1", "/v1/"].some((path) => baseUrl === `${origin}${path}`)) return baseUrl;
        // SADAI documents separate text and image endpoints: https://sadai.cc/docs?view=guide#image2
        return `https://${SADAI_IMAGE_API_HOST}/v1`;
    } catch {
        return baseUrl;
    }
}

export function isSadaiImage25Channel(baseUrl: string, model: string) {
    return SADAI_IMAGE_25_MODELS.has(model.trim().toLowerCase()) &&
        (sadaiImageBaseUrl(baseUrl, model) !== baseUrl || ["", "/", "/v1", "/v1/"].some((path) => baseUrl === `https://${SADAI_IMAGE_API_HOST}${path}`));
}

export function isSadaiImage2Channel(baseUrl: string, model: string) {
    try {
        return new URL(baseUrl).hostname.toLowerCase() === SADAI_IMAGE_API_HOST && model.trim().toLowerCase() === "gpt-image-2";
    } catch {
        return false;
    }
}

/** SADAI 托管的渠道（标准域名或专用图片域名）。 */
function isSadaiHostedChannel(baseUrl: string) {
    try {
        const { origin, hostname } = new URL(baseUrl);
        return SADAI_STANDARD_API_ORIGINS.has(origin) || hostname.toLowerCase() === SADAI_IMAGE_API_HOST;
    } catch {
        return false;
    }
}

export function isSadaiImage26Channel(baseUrl: string, model: string) {
    return model.trim().toLowerCase() === "gpt-image-2.6-flare" && isSadaiHostedChannel(baseUrl);
}

/**
 * 2.6 的链接模式开关：渠道与模型匹配、且能力注册表未禁用（上游拒绝过则回退 base64）。
 * 与 2.5 的区别仅在后者无条件启用；参数校验失败时的自动降级由调用方负责。
 */
export function sadaiUrl26Enabled(
    apiFormat: string,
    capability: { canSubmit(key: string): boolean },
    channelId: string,
    baseUrl: string,
    model: string,
) {
    return apiFormat === "openai" && isSadaiImage26Channel(baseUrl, model) &&
        capability.canSubmit(`sadai:${channelId}:${model.trim().toLowerCase()}`);
}

/**
 * 应当以图片链接（而非内嵌 base64）接收结果的 SADAI 渠道模型组合。
 * 2.5 无条件启用；2.6 是否启用由调用方的能力注册表决定（上游拒绝时自动回退 base64）。
 */
export function isSadaiUrlResultChannel(baseUrl: string, model: string) {
    if (SADAI_IMAGE_25_MODELS.has(model.trim().toLowerCase())) return isSadaiImage25Channel(baseUrl, model);
    return isSadaiImage26Channel(baseUrl, model);
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
        response_format: "b64_json",
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

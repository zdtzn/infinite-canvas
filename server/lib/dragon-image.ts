const DRAGON_IMAGE_BASE_URL = "https://draw.dragtokens.com";
const DRAGON_HOSTS = new Set(["dragtokens.com", "draw.dragtokens.com"]);
const DRAGON_STANDARD_MODEL = "gpt-image-2";
const DRAGON_FOUR_K_MODELS = new Set([
    "gpt-image-2-4k超分",
    "gpt-image-2-原生4k",
]);
const DRAGON_CHAT_IMAGE_MODELS = new Set([
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image",
    "gemini-3-pro-image-preview",
]);

const DRAGON_STANDARD_SIZES: Record<string, string> = {
    "1:1": "1254x1254",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
};

const DRAGON_FOUR_K_SIZES: Record<
    string,
    { low: string; medium?: string; high: string }
> = {
    "1:1": { low: "1024x1024", medium: "2048x2048", high: "2880x2880" },
    "4:3": { low: "1152x864", high: "3264x2448" },
    "3:4": { low: "864x1152", high: "2448x3264" },
    "3:2": { low: "1248x832", high: "3504x2336" },
    "2:3": { low: "832x1248", high: "2336x3504" },
    "16:9": { low: "1280x720", medium: "2560x1440", high: "3840x2160" },
    "9:16": { low: "720x1280", high: "2160x3840" },
    "21:9": { low: "3696x1584", high: "3696x1584" },
};

export function isDragonImageHost(baseUrl: string) {
    try {
        return DRAGON_HOSTS.has(new URL(baseUrl).hostname.toLowerCase());
    } catch {
        return false;
    }
}

export function isDragonGptImageModel(baseUrl: string, model: string) {
    const name = normalizedModelName(model);
    return (
        isDragonImageHost(baseUrl) &&
        (name === DRAGON_STANDARD_MODEL || DRAGON_FOUR_K_MODELS.has(name))
    );
}

export function isDragonFourKImageModel(baseUrl: string, model: string) {
    return (
        isDragonImageHost(baseUrl) &&
        DRAGON_FOUR_K_MODELS.has(normalizedModelName(model))
    );
}

export function isDragonChatImageModel(baseUrl: string, model: string) {
    return (
        isDragonImageHost(baseUrl) &&
        DRAGON_CHAT_IMAGE_MODELS.has(normalizedModelName(model))
    );
}

export function dragonImageBaseUrl(baseUrl: string, model: string) {
    return isDragonGptImageModel(baseUrl, model) ||
        isDragonChatImageModel(baseUrl, model)
        ? DRAGON_IMAGE_BASE_URL
        : baseUrl;
}

export function resolveDragonImageSize(
    size: string | undefined,
    quality: string | undefined,
    model: string,
    baseUrl: string,
) {
    if (!isDragonGptImageModel(baseUrl, model)) return undefined;
    const value =
        String(size || "1:1")
            .trim()
            .toLowerCase() === "auto"
            ? "1:1"
            : String(size || "1:1").trim();
    const name = normalizedModelName(model);
    if (name === DRAGON_STANDARD_MODEL) {
        const ratio = documentedRatio(
            value,
            Object.values(DRAGON_STANDARD_SIZES),
        );
        const resolved = DRAGON_STANDARD_SIZES[ratio];
        if (!resolved)
            throw new Error(
                "Dragon gpt-image-2 only supports 1:1, 3:2, or 2:3",
            );
        return resolved;
    }

    const ratio = documentedRatio(
        value,
        Object.values(DRAGON_FOUR_K_SIZES).flatMap(
            (entry) =>
                [entry.low, entry.medium, entry.high].filter(
                    Boolean,
                ) as string[],
        ),
    );
    const supported = DRAGON_FOUR_K_SIZES[ratio];
    if (!supported)
        throw new Error(
            "Dragon 4K image models do not support the requested aspect ratio",
        );
    const resolution = String(quality || "low")
        .trim()
        .toLowerCase();
    if (resolution === "high") return supported.high;
    if (resolution === "medium") return supported.medium || supported.low;
    return supported.low;
}

export function dragonPromptWithSize(
    prompt: string,
    requestedSize: string | undefined,
    resolvedSize: string | undefined,
    model: string,
    baseUrl: string,
) {
    if (!resolvedSize || !isDragonFourKImageModel(baseUrl, model))
        return prompt;
    const ratio =
        ratioFromValue(String(requestedSize || "1:1")) ||
        ratioFromValue(resolvedSize) ||
        "1:1";
    return `${prompt}\n\n请保持 ${ratio} 构图，并输出 ${resolvedSize} 尺寸。`;
}

export function buildDragonChatImageRequest(input: {
    model: string;
    prompt: string;
    size?: string;
    references: string[];
}) {
    const content: string | Array<Record<string, unknown>> = input.references
        .length
        ? [
              { type: "text", text: input.prompt },
              ...input.references.map((url) => ({
                  type: "image_url",
                  image_url: { url },
              })),
          ]
        : input.prompt;
    return {
        model: input.model,
        messages: [{ role: "user", content }],
        modalities: ["text", "image"],
        image_config: { aspect_ratio: "1:1" },
    };
}

export function dragonChatImageUrls(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return [];
    const choices = Array.isArray((payload as Record<string, unknown>).choices)
        ? ((payload as Record<string, unknown>).choices as Array<
              Record<string, any>
          >)
        : [];
    const urls: string[] = [];
    for (const choice of choices) {
        const content = choice?.message?.content;
        if (typeof content === "string") {
            for (const match of content.matchAll(
                /!\[[^\]]*]\((https?:\/\/[^)]+)\)/g,
            ))
                urls.push(match[1]);
        } else if (Array.isArray(content)) {
            for (const item of content) {
                const value =
                    item?.image_url?.url || item?.image_url || item?.url;
                if (typeof value === "string" && /^https?:\/\//i.test(value))
                    urls.push(value);
            }
        }
    }
    return Array.from(new Set(urls));
}

function documentedRatio(value: string, documentedSizes: string[]) {
    const normalized = value.toLowerCase();
    if (/^\d+x\d+$/i.test(normalized)) {
        if (!documentedSizes.includes(normalized)) return "";
        return ratioFromValue(normalized);
    }
    return ratioFromValue(normalized);
}

function ratioFromValue(value: string) {
    const match = value.match(/^(\d+)\s*[:x]\s*(\d+)$/i);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "";
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function normalizedModelName(model: string) {
    return model.toLowerCase().split("::").at(-1)?.trim() || "";
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

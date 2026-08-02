import { deriveImageModelCapabilities } from "./model-capabilities";
import { modelOptionName, normalizeImageSizeSelection, resolveModelChannel, type AiConfig } from "./use-config-store";

const RESOLUTION_ORDER = ["low", "medium", "high"];

export function resolveImageModelSettings(config: AiConfig, selectedModel: string, maxCount = 15) {
    const model = selectedModel || config.imageModel || config.model;
    const channel = resolveModelChannel(config, model);
    const capabilities = deriveImageModelCapabilities(modelOptionName(model), channel.apiFormat, channel.baseUrl);
    const quality = supportedResolution(config.quality, capabilities.resolutions);
    const imageQuality = capabilities.generationQualities.includes(config.imageQuality) ? config.imageQuality : "auto";
    const size = supportedSize(config.size, capabilities.sizes, capabilities.customSize);
    const imageOutputFormat = ["auto", "png", "jpeg", "webp"].includes(config.imageOutputFormat) ? config.imageOutputFormat : "auto";
    const background = config.background === "transparent" && capabilities.transparentBackground && imageOutputFormat !== "jpeg" ? "transparent" : "";
    const count = Math.max(1, Math.min(maxCount, capabilities.maxOutputs, Math.floor(Math.abs(Number(config.count)) || 1)));

    return {
        channel,
        capabilities,
        config: {
            ...config,
            model,
            imageModel: model,
            quality,
            imageQuality,
            imageOutputFormat,
            size,
            background,
            count: String(count),
        },
    };
}

function supportedResolution(value: string, supported: string[]) {
    if (supported.includes(value)) return value;
    if (supported.includes("auto")) return "auto";
    const requestedIndex = RESOLUTION_ORDER.indexOf(value);
    if (requestedIndex >= 0) {
        for (let index = requestedIndex; index >= 0; index -= 1) {
            if (supported.includes(RESOLUTION_ORDER[index])) return RESOLUTION_ORDER[index];
        }
    }
    return supported[0] || "low";
}

function supportedSize(value: string, supported: string[], customSize: boolean) {
    const size = normalizeImageSizeSelection(value);
    if (/^\d+x\d+$/i.test(size)) return customSize ? size : closestSupportedRatio(size, supported);
    if (supported.includes(size)) return size;
    return closestSupportedRatio(size, supported);
}

function closestSupportedRatio(value: string, supported: string[]) {
    const target = readRatio(value);
    const ratios = supported.map((item) => ({ item, ratio: readRatio(item) })).filter((entry): entry is { item: string; ratio: number } => Boolean(entry.ratio));
    if (!target || !ratios.length) return supported.includes("1:1") ? "1:1" : supported[0] || "1:1";
    return ratios.reduce((best, entry) => (Math.abs(Math.log(entry.ratio / target)) < Math.abs(Math.log(best.ratio / target)) ? entry : best)).item;
}

function readRatio(value: string) {
    const match = value.match(/^(\d+)\s*[:x]\s*(\d+)$/i);
    if (!match) return 0;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width / height : 0;
}

import type { ApiCallFormat } from "./use-config-store";

export type ImageModelCapabilities = {
    resolutions: string[];
    generationQualities: string[];
    outputFormats: string[];
    sizes: string[];
    customSize: boolean;
    transparentBackground: boolean;
    maxReferences: number;
    maxOutputs: number;
};

const COMMON_SIZES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const OUTPUT_RESOLUTIONS = ["low", "medium", "high"];

export function deriveImageModelCapabilities(model: string, apiFormat: ApiCallFormat, baseUrl = ""): ImageModelCapabilities {
    const name = model.toLowerCase().split("::").at(-1)?.trim() || "";
    if (isUuAsyncGptImageModel(baseUrl, name)) {
        return {
            resolutions: OUTPUT_RESOLUTIONS,
            generationQualities: ["auto"],
            outputFormats: ["auto"],
            sizes: COMMON_SIZES,
            customSize: true,
            transparentBackground: false,
            maxReferences: 16,
            maxOutputs: 10,
        };
    }
    if (apiFormat === "gemini") {
        return {
            resolutions: OUTPUT_RESOLUTIONS,
            generationQualities: ["auto"],
            outputFormats: ["auto"],
            sizes: [...COMMON_SIZES, "1:4", "4:1", "1:8", "8:1", "4:5", "5:4", "21:9"],
            customSize: false,
            transparentBackground: false,
            maxReferences: 10,
            maxOutputs: 4,
        };
    }
    if (name.includes("gpt-image")) {
        return {
            resolutions: OUTPUT_RESOLUTIONS,
            generationQualities: ["auto", "low", "medium", "high"],
            outputFormats: ["auto", "png", "jpeg", "webp"],
            sizes: COMMON_SIZES,
            customSize: true,
            transparentBackground: true,
            maxReferences: 16,
            maxOutputs: 10,
        };
    }
    if (name.includes("dall-e") || name.includes("dalle")) {
        return {
            resolutions: OUTPUT_RESOLUTIONS,
            generationQualities: ["auto", "standard", "hd"],
            outputFormats: ["auto"],
            sizes: COMMON_SIZES,
            customSize: true,
            transparentBackground: true,
            maxReferences: 16,
            maxOutputs: 10,
        };
    }
    return {
        resolutions: OUTPUT_RESOLUTIONS,
        generationQualities: ["auto"],
        outputFormats: ["auto"],
        sizes: COMMON_SIZES,
        customSize: true,
        transparentBackground: false,
        maxReferences: 4,
        maxOutputs: 4,
    };
}

export function validateImageRequest(
    capabilities: ImageModelCapabilities,
    request: { resolution: string; imageQuality?: string; imageOutputFormat?: string; size: string; background: string; referenceCount: number; count?: number },
) {
    if (request.resolution && !capabilities.resolutions.includes(request.resolution)) throw new Error(`当前模型不支持“${request.resolution}”输出分辨率`);
    if (request.imageQuality && request.imageQuality !== "auto" && !capabilities.generationQualities.includes(request.imageQuality)) throw new Error(`当前模型不支持“${request.imageQuality}”生成质量`);
    if (request.imageOutputFormat && !["auto", "png", "jpeg", "webp"].includes(request.imageOutputFormat)) throw new Error("输出格式参数无效");
    const customSize = /^\d+x\d+$/i.test(request.size);
    if (request.size && !customSize && !capabilities.sizes.includes(request.size)) throw new Error(`当前模型不支持“${request.size}”尺寸`);
    if (customSize && !capabilities.customSize) throw new Error("当前模型不支持自定义像素尺寸");
    if (request.background === "transparent" && !capabilities.transparentBackground) throw new Error("当前模型不支持透明背景");
    if (request.background === "transparent" && request.imageOutputFormat === "jpeg") throw new Error("JPEG 不支持透明背景");
    if (request.referenceCount > capabilities.maxReferences) throw new Error(`当前模型最多支持 ${capabilities.maxReferences} 张参考图`);
    if ((request.count || 1) > capabilities.maxOutputs) throw new Error(`当前模型单次最多生成 ${capabilities.maxOutputs} 张图片`);
}

function isUuAsyncGptImageModel(baseUrl: string, model: string) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        const isUuHost = ["uuapi.cc", "uuapi.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        return isUuHost && model.trim().toLowerCase() === "gpt-image-2";
    } catch {
        return false;
    }
}

import type { ApiCallFormat } from "./use-config-store";

export type ImageModelCapabilities = {
    qualities: string[];
    sizes: string[];
    customSize: boolean;
    transparentBackground: boolean;
    maxReferences: number;
    maxOutputs: number;
};

const COMMON_SIZES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];

export function deriveImageModelCapabilities(model: string, apiFormat: ApiCallFormat): ImageModelCapabilities {
    const name = model.toLowerCase();
    if (apiFormat === "gemini") {
        return {
            qualities: ["auto", "high", "medium", "low"],
            sizes: [...COMMON_SIZES, "1:4", "4:1", "1:8", "8:1", "4:5", "5:4", "21:9"],
            customSize: false,
            transparentBackground: false,
            maxReferences: 10,
            maxOutputs: 4,
        };
    }
    if (name.includes("gpt-image") || name.includes("dall-e") || name.includes("dalle")) {
        return {
            qualities: ["auto", "high", "medium", "low"],
            sizes: COMMON_SIZES,
            customSize: true,
            transparentBackground: true,
            maxReferences: 16,
            maxOutputs: 10,
        };
    }
    return {
        qualities: ["auto", "high", "medium", "low"],
        sizes: COMMON_SIZES,
        customSize: true,
        transparentBackground: false,
        maxReferences: 4,
        maxOutputs: 4,
    };
}

export function validateImageRequest(
    capabilities: ImageModelCapabilities,
    request: { quality: string; size: string; background: string; referenceCount: number; count?: number },
) {
    if (request.quality && !capabilities.qualities.includes(request.quality)) throw new Error(`当前模型不支持“${request.quality}”质量`);
    const customSize = /^\d+x\d+$/i.test(request.size);
    if (request.size && !customSize && !capabilities.sizes.includes(request.size)) throw new Error(`当前模型不支持“${request.size}”尺寸`);
    if (customSize && !capabilities.customSize) throw new Error("当前模型不支持自定义像素尺寸");
    if (request.background === "transparent" && !capabilities.transparentBackground) throw new Error("当前模型不支持透明背景");
    if (request.referenceCount > capabilities.maxReferences) throw new Error(`当前模型最多支持 ${capabilities.maxReferences} 张参考图`);
    if ((request.count || 1) > capabilities.maxOutputs) throw new Error(`当前模型单次最多生成 ${capabilities.maxOutputs} 张图片`);
}

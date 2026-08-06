import type { ChannelImageCapabilityConfig } from "../types";
import type { ProviderProtocol } from "./url-policy";

export type ServerImageCapabilities = {
  resolutions: string[];
  generationQualities: string[];
  outputFormats: string[];
  sizes: string[];
  customSize: boolean;
  transparentBackground: boolean;
  maxReferences: number;
  maxOutputs: number;
};

export type ServerImageCapabilityProfile = {
  capabilities: ServerImageCapabilities;
  source: "documented" | "custom" | "conservative" | "legacy";
  label: string;
};

export type ServerImageCapabilityRequest = {
  resolution?: string;
  imageQuality?: string;
  imageOutputFormat?: string;
  size?: string;
  background?: string;
  referenceCount: number;
  count: number;
};

const COMMON_SIZES = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const GPT_IMAGE_2_SIZES = ["1:1", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3"];
const LEGACY_GPT_IMAGE_SIZES = ["1:1", "3:2", "2:3"];
const SADAI_SIZES = ["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"];
const DRAGON_FOUR_K_SIZES = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"];
const OUTPUT_RESOLUTIONS = ["low", "medium", "high"];

const CONSERVATIVE_CAPABILITIES: ServerImageCapabilities = {
  resolutions: ["auto"],
  generationQualities: ["auto"],
  outputFormats: ["auto"],
  sizes: ["1:1"],
  customSize: false,
  transparentBackground: false,
  maxReferences: 1,
  maxOutputs: 1,
};

const LEGACY_GENERIC_CAPABILITIES: ServerImageCapabilities = {
  resolutions: OUTPUT_RESOLUTIONS,
  generationQualities: ["auto"],
  outputFormats: ["auto"],
  sizes: COMMON_SIZES,
  customSize: true,
  transparentBackground: false,
  maxReferences: 4,
  maxOutputs: 4,
};

export function resolveServerImageCapabilityProfile(model: string, apiFormat: ProviderProtocol, baseUrl = "", configured?: ChannelImageCapabilityConfig): ServerImageCapabilityProfile {
  if (configured?.mode === "custom")
    return {
      capabilities: customImageCapabilities(configured),
      source: "custom",
      label: "按渠道文档自定义",
    };
  if (configured?.mode === "conservative")
    return {
      capabilities: { ...CONSERVATIVE_CAPABILITIES },
      source: "conservative",
      label: "保守模式",
    };

  const documented = documentedImageCapabilities(model, apiFormat, baseUrl);
  if (documented) return documented;
  if (configured?.mode === "auto")
    return {
      capabilities: { ...CONSERVATIVE_CAPABILITIES },
      source: "conservative",
      label: "未识别，自动使用保守模式",
    };
  return {
    capabilities: { ...LEGACY_GENERIC_CAPABILITIES },
    source: "legacy",
    label: "旧版兼容规则",
  };
}

export function validateServerImageCapabilityRequest(capabilities: ServerImageCapabilities, request: ServerImageCapabilityRequest) {
  if (request.resolution && !capabilities.resolutions.includes(request.resolution)) throw new Error(`当前模型不支持“${request.resolution}”输出分辨率`);
  if (request.imageQuality && request.imageQuality !== "auto" && !capabilities.generationQualities.includes(request.imageQuality)) {
    throw new Error(`当前模型不支持“${request.imageQuality}”生成质量`);
  }
  if (request.imageOutputFormat && request.imageOutputFormat !== "auto" && !capabilities.outputFormats.includes(request.imageOutputFormat)) {
    throw new Error(`当前模型不支持“${request.imageOutputFormat}”输出格式`);
  }
  const customSize = /^\d+x\d+$/i.test(request.size || "");
  if (request.size && !customSize && !capabilities.sizes.includes(request.size)) throw new Error(`当前模型不支持“${request.size}”尺寸`);
  if (customSize && !capabilities.customSize) throw new Error("当前模型不支持自定义像素尺寸");
  if (request.background === "transparent" && !capabilities.transparentBackground) throw new Error("当前模型不支持透明背景");
  if (request.background === "transparent" && request.imageOutputFormat === "jpeg") throw new Error("JPEG 不支持透明背景");
  if (request.referenceCount > capabilities.maxReferences) throw new Error(`当前模型最多支持 ${capabilities.maxReferences} 张参考图`);
  if (request.count > capabilities.maxOutputs) throw new Error(`当前模型单次最多生成 ${capabilities.maxOutputs} 张图片`);
}

function documentedImageCapabilities(model: string, apiFormat: ProviderProtocol, baseUrl: string): ServerImageCapabilityProfile | null {
  const name = model.toLowerCase().split("::").at(-1)?.trim() || "";
  if (isDragonImageHost(baseUrl)) {
    if (name === "gpt-image-2") {
      return documented("Dragon GPT Image 2", {
        resolutions: ["low"],
        generationQualities: ["auto", "low", "medium", "high"],
        outputFormats: ["auto", "png", "jpeg", "webp"],
        sizes: LEGACY_GPT_IMAGE_SIZES,
        customSize: false,
        transparentBackground: false,
        maxReferences: 16,
        maxOutputs: 10,
      });
    }
    if (["gpt-image-2-4k超分", "gpt-image-2-原生4k"].includes(name)) {
      return documented("Dragon GPT Image 2 4K", {
        resolutions: ["low", "high"],
        generationQualities: ["auto", "low", "medium", "high"],
        outputFormats: ["auto", "png", "jpeg", "webp"],
        sizes: DRAGON_FOUR_K_SIZES,
        customSize: false,
        transparentBackground: false,
        maxReferences: 16,
        maxOutputs: 10,
      });
    }
    if (["gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image", "gemini-3-pro-image-preview"].includes(name)) {
      return documented("Dragon Gemini Image", {
        resolutions: ["medium"],
        generationQualities: ["auto"],
        outputFormats: ["auto"],
        sizes: ["1:1"],
        customSize: false,
        transparentBackground: false,
        maxReferences: 10,
        maxOutputs: 1,
      });
    }
  }
  if (isUuAsyncGptImageModel(baseUrl, name)) {
    return documented("UU GPT Image 2", {
      resolutions: OUTPUT_RESOLUTIONS,
      generationQualities: ["auto"],
      outputFormats: ["auto"],
      sizes: GPT_IMAGE_2_SIZES,
      customSize: false,
      transparentBackground: false,
      maxReferences: 16,
      maxOutputs: 10,
    });
  }
  if (isSadaiImage2Model(baseUrl, name)) {
    return documented("SADAI Image2", {
      resolutions: OUTPUT_RESOLUTIONS,
      generationQualities: ["auto", "low", "medium", "high"],
      outputFormats: ["auto"],
      sizes: SADAI_SIZES,
      customSize: false,
      transparentBackground: false,
      maxReferences: 6,
      maxOutputs: 10,
    });
  }
  if (apiFormat === "gemini") {
    return documented("Gemini Image", {
      resolutions: supportsGeminiImageSize(name) ? OUTPUT_RESOLUTIONS : ["auto"],
      generationQualities: ["auto"],
      outputFormats: ["auto"],
      sizes: [...COMMON_SIZES, "1:4", "4:1", "1:8", "8:1", "4:5", "5:4", "21:9"],
      customSize: false,
      transparentBackground: false,
      maxReferences: 10,
      maxOutputs: 4,
    });
  }
  if (name === "gpt-image-2") {
    return documented("OpenAI GPT Image 2", {
      resolutions: OUTPUT_RESOLUTIONS,
      generationQualities: ["auto", "low", "medium", "high"],
      outputFormats: ["auto", "png", "jpeg", "webp"],
      sizes: GPT_IMAGE_2_SIZES,
      customSize: true,
      transparentBackground: false,
      maxReferences: 16,
      maxOutputs: 10,
    });
  }
  if (isLegacyGptImageModel(name)) {
    return documented("OpenAI GPT Image 1", {
      resolutions: ["low"],
      generationQualities: ["auto", "low", "medium", "high"],
      outputFormats: ["auto", "png", "jpeg", "webp"],
      sizes: LEGACY_GPT_IMAGE_SIZES,
      customSize: false,
      transparentBackground: true,
      maxReferences: 16,
      maxOutputs: 10,
    });
  }
  if (name.includes("gpt-image")) {
    return documented("GPT Image 兼容模型", {
      resolutions: OUTPUT_RESOLUTIONS,
      generationQualities: ["auto", "low", "medium", "high"],
      outputFormats: ["auto", "png", "jpeg", "webp"],
      sizes: COMMON_SIZES,
      customSize: true,
      transparentBackground: true,
      maxReferences: 16,
      maxOutputs: 10,
    });
  }
  if (name.includes("dall-e") || name.includes("dalle")) {
    return documented("DALL-E", {
      resolutions: ["low"],
      generationQualities: ["auto", "standard", "hd"],
      outputFormats: ["auto"],
      sizes: ["1:1"],
      customSize: false,
      transparentBackground: false,
      maxReferences: 1,
      maxOutputs: 1,
    });
  }
  return null;
}

function documented(label: string, capabilities: ServerImageCapabilities): ServerImageCapabilityProfile {
  return { capabilities, source: "documented", label };
}

function customImageCapabilities(configured: ChannelImageCapabilityConfig): ServerImageCapabilities {
  return {
    resolutions: normalizedOptions(configured.resolutions, ["auto", "low", "medium", "high"], ["auto"]),
    generationQualities: normalizedOptions(configured.generationQualities, ["auto", "low", "medium", "high", "standard", "hd"], ["auto"]),
    outputFormats: normalizedOptions(configured.outputFormats, ["auto", "png", "jpeg", "webp"], ["auto"]),
    sizes: normalizedRatios(configured.sizes),
    customSize: Boolean(configured.customSize),
    transparentBackground: Boolean(configured.transparentBackground),
    maxReferences: boundedInteger(configured.maxReferences, 0, 16, 1),
    maxOutputs: boundedInteger(configured.maxOutputs, 1, 10, 1),
  };
}

function normalizedOptions(input: string[] | undefined, allowed: string[], fallback: string[]) {
  const values = Array.from(new Set((input || []).map((value) => String(value).trim().toLowerCase()).filter((value) => allowed.includes(value))));
  return values.length ? values : fallback;
}

function normalizedRatios(input: string[] | undefined) {
  const values = Array.from(new Set((input || []).map((value) => String(value).trim()).filter((value) => /^\d{1,3}:\d{1,3}$/.test(value)))).slice(0, 30);
  return values.length ? values : ["1:1"];
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function isDragonImageHost(baseUrl: string) {
  try {
    return ["dragtokens.com", "draw.dragtokens.com"].includes(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isUuAsyncGptImageModel(baseUrl: string, model: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return ["uuapi.cc", "uuapi.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) && model === "gpt-image-2";
  } catch {
    return false;
  }
}

function isSadaiImage2Model(baseUrl: string, model: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.sadai.top" && model === "gpt-image-2";
  } catch {
    return false;
  }
}

function supportsGeminiImageSize(model: string) {
  return model.includes("gemini-3") || model.includes("3.1") || model.includes("3-pro");
}

function isLegacyGptImageModel(model: string) {
  return /^gpt-image-1(?:$|[.-])/.test(model);
}

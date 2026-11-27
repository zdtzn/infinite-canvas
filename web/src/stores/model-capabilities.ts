import { isGptImage25Model, isUuAsyncGptImageModel, resolveImageModelCapabilityProfile, type ChannelImageCapabilityConfig } from "../../../shared/image-model-capabilities";

export { isSadaiImage2Model, isUuAsyncGptImageModel, resolveImageModelCapabilityProfile, validateImageRequest, type ChannelImageCapabilityConfig, type ImageModelCapabilities } from "../../../shared/image-model-capabilities";

export function deriveImageModelCapabilities(model: string, apiFormat: "openai" | "gemini", baseUrl = "", configured?: ChannelImageCapabilityConfig) {
    return resolveImageModelCapabilityProfile(model, apiFormat, baseUrl, configured).capabilities;
}

export function isUuImage25Model(baseUrl: string, model: string) {
    return isGptImage25Model(model) && isUuAsyncGptImageModel(baseUrl, "gpt-image-2");
}

export function resolveImageSlotConcurrency(baseUrl: string, model: string, requestedConcurrency: number) {
    const concurrency = Math.max(1, Math.floor(requestedConcurrency) || 1);
    return isUuAsyncGptImageModel(baseUrl, model) ? 1 : concurrency;
}

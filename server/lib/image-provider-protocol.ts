/** Wire-level fields shared by server image job submission paths. */
export function imageEditReferenceField(referenceCount: number) {
    return referenceCount > 1 ? "image[]" : "image";
}

export function geminiImageGenerationConfig(image: Record<string, string>) {
    return { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(image).length ? { imageConfig: image } : {}) };
}

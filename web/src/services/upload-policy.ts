export const IMAGE_UPLOAD_LIMITS = {
    maxBytes: 16 * 1024 * 1024,
    maxPixels: 50_000_000,
    maxEdge: 12_000,
    maxReferences: 10,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"] as const,
};

export function assertImageUploadAllowed(input: { bytes: number; mimeType: string; width: number; height: number }) {
    const mimeType = input.mimeType.toLowerCase();
    if (!IMAGE_UPLOAD_LIMITS.allowedMimeTypes.includes(mimeType as (typeof IMAGE_UPLOAD_LIMITS.allowedMimeTypes)[number])) {
        throw new Error("图片格式不支持，请使用 JPG、PNG、WebP 或 AVIF");
    }
    if (input.bytes <= 0 || input.bytes > IMAGE_UPLOAD_LIMITS.maxBytes) throw new Error("图片大小不能超过 16 MB");
    if (input.width <= 0 || input.height <= 0 || input.width > IMAGE_UPLOAD_LIMITS.maxEdge || input.height > IMAGE_UPLOAD_LIMITS.maxEdge || input.width * input.height > IMAGE_UPLOAD_LIMITS.maxPixels) {
        throw new Error("图片像素过大，请压缩到 5000 万像素以内");
    }
}

export async function assertStorageQuotaAvailable(nextBytes: number) {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota) return;
    const usage = estimate.usage || 0;
    if (usage + nextBytes > estimate.quota * 0.85) throw new Error("浏览器存储空间不足，请先清理旧图片或使用更小的文件");
}

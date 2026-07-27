import localforage from "localforage";

import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { readImageMeta } from "@/lib/image-utils";
import { deleteServerAsset, fetchServerAssetBlob, promoteServerJobAsset, uploadServerAsset } from "@/services/server-api";
import { assertImageUploadAllowed, assertStorageQuotaAvailable } from "@/services/upload-policy";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    thumbnailUrl?: string;
    thumbnailKey?: string;
};

export type ImageOutputFormat = "auto" | "png" | "jpeg" | "webp";

type ImageUploadMeta = {
    width: number;
    height: number;
    mimeType?: string;
};

type UploadImageOptions = {
    outputFormat?: string;
    imageMeta?: ImageUploadMeta;
    dimensions?: { width: number; height: number };
    createThumbnail?: boolean;
    previewUrl?: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();
const promotedJobImages = new Map<string, Promise<UploadedImage>>();

export async function uploadImage(input: string | Blob, options?: UploadImageOptions): Promise<UploadedImage> {
    if (PUBLIC_MODE && typeof input === "string" && canPromoteServerJobImage(input, options?.outputFormat)) {
        const existing = promotedJobImages.get(input);
        if (existing) return existing;
        const pending = promoteJobImage(input);
        promotedJobImages.set(input, pending);
        try {
            return await pending;
        } finally {
            if (promotedJobImages.get(input) === pending) promotedJobImages.delete(input);
        }
    }

    const blob = await convertImageOutput(input, options?.outputFormat);
    const suppliedMeta = options?.imageMeta || options?.dimensions;
    const meta: ImageUploadMeta = validDimensions(suppliedMeta)
        ? { ...suppliedMeta, mimeType: options?.imageMeta?.mimeType || blob.type }
        : await readBlobMeta(blob);
    const mimeType = blob.type || meta.mimeType || "image/png";
    assertImageUploadAllowed({ bytes: blob.size, mimeType, width: meta.width, height: meta.height });
    const thumbnail = options?.createThumbnail === false ? null : await createThumbnail(blob, meta.width, meta.height);
    if (PUBLIC_MODE) {
        const { asset } = await uploadServerAsset(blob, "image");
        const thumbnailAsset = thumbnail ? (await uploadServerAsset(thumbnail, "image")).asset : undefined;
        const url = options?.previewUrl ? rememberObjectUrl(asset.key, options.previewUrl) : asset.url;
        return { url, storageKey: asset.key, width: meta.width, height: meta.height, bytes: asset.bytes, mimeType: asset.mimeType, thumbnailKey: thumbnailAsset?.key, thumbnailUrl: thumbnailAsset?.url };
    }
    await assertStorageQuotaAvailable(blob.size);
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = rememberObjectUrl(storageKey, options?.previewUrl || URL.createObjectURL(blob));
    const thumbnailKey = thumbnail ? `image:thumb:${nanoid()}` : undefined;
    if (thumbnail && thumbnailKey) {
        await store.setItem(thumbnailKey, thumbnail);
        rememberObjectUrl(thumbnailKey, URL.createObjectURL(thumbnail));
    }
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType, thumbnailKey, thumbnailUrl: thumbnailKey ? objectUrls.get(thumbnailKey) : undefined };
}

export function canPromoteServerJobImage(input: string, outputFormat?: string) {
    if (!/^\/api\/job-files\/[^/?#]+\/[^/?#]+$/i.test(input)) return false;
    const targetMimeType = imageOutputFormatMimeType(outputFormat);
    if (!targetMimeType) return true;
    const extension = input.slice(input.lastIndexOf(".")).toLowerCase();
    const sourceMimeType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extension];
    return sourceMimeType === targetMimeType;
}

async function promoteJobImage(sourceUrl: string): Promise<UploadedImage> {
    const { asset, width, height } = await promoteServerJobAsset(sourceUrl);
    const meta = Number.isSafeInteger(width) && Number.isSafeInteger(height) && (width || 0) > 0 && (height || 0) > 0 ? { width: width!, height: height! } : await readImageMeta(sourceUrl);
    try {
        assertImageUploadAllowed({ bytes: asset.bytes, mimeType: asset.mimeType, width: meta.width, height: meta.height });
    } catch (error) {
        await deleteServerAsset(asset.key).catch(() => undefined);
        throw error;
    }
    return { url: sourceUrl, storageKey: asset.key, width: meta.width, height: meta.height, bytes: asset.bytes, mimeType: asset.mimeType };
}

export async function readImageBlob(input: string | Blob) {
    const blob =
        typeof input === "string"
            ? /^data:/i.test(input)
                ? decodeDataUrl(input)
                : await fetch(input, { credentials: "same-origin" }).then(async (response) => {
                      if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
                      return response.blob();
                  })
            : input;
    if (!blob.size) throw new Error("读取图片失败：文件为空");
    const mimeType = await detectImageMimeType(blob);
    if (mimeType) return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    if (blob.type.startsWith("image/")) return blob;
    throw new Error("读取图片失败：返回内容不是图片");
}

function decodeDataUrl(value: string) {
    const commaIndex = value.indexOf(",");
    if (commaIndex < 5) throw new Error("读取图片失败：Data URL 格式无效");
    const metadata = value.slice(5, commaIndex);
    const mimeType = metadata.split(";", 1)[0] || "application/octet-stream";
    const payload = value.slice(commaIndex + 1);

    try {
        if (!metadata.split(";").some((part) => part.toLowerCase() === "base64")) return new Blob([decodeURIComponent(payload)], { type: mimeType });
        const binary = atob(payload.replace(/\s/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new Blob([bytes], { type: mimeType });
    } catch {
        throw new Error("读取图片失败：Data URL 无法解码");
    }
}

/** Encode a generated result locally when its gateway ignores output_format. */
export async function convertImageOutput(input: string | Blob, outputFormat?: string) {
    const blob = await readImageBlob(input);
    const targetMimeType = imageOutputFormatMimeType(outputFormat);
    if (!targetMimeType || blob.type.toLowerCase() === targetMimeType) return blob;
    if (typeof document === "undefined") throw new Error("当前环境无法转换图片格式");

    const source = await loadCanvasSource(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d", { alpha: targetMimeType !== "image/jpeg" });
        if (!context) throw new Error("当前浏览器无法转换图片格式");
        if (targetMimeType === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
        const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetMimeType, targetMimeType === "image/jpeg" ? 0.92 : undefined));
        if (!converted || converted.type.toLowerCase() !== targetMimeType) throw new Error("当前浏览器不支持所选图片格式");
        return converted;
    } finally {
        source.dispose();
    }
}

async function detectImageMimeType(blob: Blob) {
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
    const header = new TextDecoder().decode(bytes);
    if (header.slice(4, 8) === "ftyp" && (header.includes("avif") || header.includes("avis"))) return "image/avif";
    return "";
}

function imageOutputFormatMimeType(value?: string) {
    const format = String(value || "auto")
        .trim()
        .toLowerCase() as ImageOutputFormat;
    return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as Partial<Record<ImageOutputFormat, string>>)[format];
}

async function loadCanvasSource(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; dispose: () => void }> {
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    }

    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("图片转换失败：无法解码图片"));
        element.src = objectUrl;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
    return expected.every((value, index) => bytes[offset + index] === value);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (PUBLIC_MODE) return `/api/assets/${encodeURIComponent(storageKey)}`;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (PUBLIC_MODE) return fetchServerAssetBlob(storageKey);
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (PUBLIC_MODE) return (await uploadServerAsset(blob, storageKey.split(":")[0] || "image", storageKey)).asset.url;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const uniqueKeys = Array.from(new Set(keys));
    uniqueKeys.forEach(forgetObjectUrl);
    if (PUBLIC_MODE) {
        await Promise.all(uniqueKeys.map((key) => deleteServerAsset(key).catch(() => undefined)));
        return;
    }
    await Promise.all(
        uniqueKeys.map(async (key) => {
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    if ("thumbnailKey" in value && typeof value.thumbnailKey === "string" && value.thumbnailKey.startsWith("image:")) keys.add(value.thumbnailKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

async function createThumbnail(blob: Blob, width: number, height: number) {
    const longest = Math.max(width, height);
    if (longest <= 1024 || typeof createImageBitmap !== "function") return null;
    const scale = 512 / longest;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.getContext("2d", { alpha: false })?.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function readBlobMeta(blob: Blob) {
    const previewUrl = URL.createObjectURL(blob);
    try {
        return await readImageMeta(previewUrl);
    } finally {
        URL.revokeObjectURL(previewUrl);
    }
}

function validDimensions(value?: { width: number; height: number }): value is { width: number; height: number } {
    return Boolean(value && Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0);
}

function rememberObjectUrl(storageKey: string, url: string) {
    const previous = objectUrls.get(storageKey);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    objectUrls.set(storageKey, url);
    return url;
}

function forgetObjectUrl(storageKey: string) {
    const url = objectUrls.get(storageKey);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(storageKey);
}

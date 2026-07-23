import localforage from "localforage";

import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { readImageMeta } from "@/lib/image-utils";
import { deleteServerAsset, fetchServerAssetBlob, uploadServerAsset } from "@/services/server-api";
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

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob, options?: { outputFormat?: string }): Promise<UploadedImage> {
    const blob = await convertImageOutput(input, options?.outputFormat);
    const previewUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(previewUrl);
    URL.revokeObjectURL(previewUrl);
    const mimeType = blob.type || meta.mimeType;
    assertImageUploadAllowed({ bytes: blob.size, mimeType, width: meta.width, height: meta.height });
    const thumbnail = await createThumbnail(blob, meta.width, meta.height);
    if (PUBLIC_MODE) {
        const { asset } = await uploadServerAsset(blob, "image");
        const thumbnailAsset = thumbnail ? (await uploadServerAsset(thumbnail, "image")).asset : undefined;
        return { url: asset.url, storageKey: asset.key, width: meta.width, height: meta.height, bytes: asset.bytes, mimeType: asset.mimeType, thumbnailKey: thumbnailAsset?.key, thumbnailUrl: thumbnailAsset?.url };
    }
    await assertStorageQuotaAvailable(blob.size);
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const thumbnailKey = thumbnail ? `image:thumb:${nanoid()}` : undefined;
    if (thumbnail && thumbnailKey) {
        await store.setItem(thumbnailKey, thumbnail);
        objectUrls.set(thumbnailKey, URL.createObjectURL(thumbnail));
    }
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType, thumbnailKey, thumbnailUrl: thumbnailKey ? objectUrls.get(thumbnailKey) : undefined };
}

export async function readImageBlob(input: string | Blob) {
    const blob =
        typeof input === "string"
            ? await fetch(input, { credentials: "same-origin" }).then(async (response) => {
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
    const format = String(value || "auto").trim().toLowerCase() as ImageOutputFormat;
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
    if (PUBLIC_MODE) {
        await Promise.all(Array.from(new Set(keys)).map((key) => deleteServerAsset(key).catch(() => undefined)));
        return;
    }
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
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

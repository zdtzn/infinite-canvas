import localforage from "localforage";
import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { deleteServerAsset, fetchServerAssetBlob, fetchServerResource, uploadServerAsset } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", expectedUserId = useUserStore.getState().user?.id || ""): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetchServerResource(input, {}, expectedUserId)).blob() : input;
    if (PUBLIC_MODE) {
        const { asset } = await uploadServerAsset(blob, prefix, undefined, expectedUserId);
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(asset.url) : blob.type.startsWith("audio/") ? await readAudioMeta(asset.url) : {};
        return { url: asset.url, storageKey: asset.key, bytes: asset.bytes, mimeType: asset.mimeType, ...meta };
    }
    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (PUBLIC_MODE) return `/api/assets/${encodeURIComponent(storageKey)}`;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    const resolved = objectUrls.get(storageKey);
    if (resolved) return resolved;
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string, expectedUserId = useUserStore.getState().user?.id || "") {
    if (PUBLIC_MODE) return fetchServerAssetBlob(storageKey, expectedUserId);
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob, expectedUserId = useUserStore.getState().user?.id || "") {
    if (PUBLIC_MODE) return (await uploadServerAsset(blob, storageKey.split(":")[0] || "file", storageKey, expectedUserId)).asset.url;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>, expectedUserId = useUserStore.getState().user?.id || "") {
    if (PUBLIC_MODE) {
        await Promise.all(Array.from(new Set(keys)).map((key) => deleteServerAsset(key, expectedUserId).catch(() => undefined)));
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

export async function cleanupUnusedMedia(usedData: unknown) {
    if (PUBLIC_MODE) return;
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => {
            const meta = { width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined };
            video.onloadedmetadata = video.onerror = null;
            video.removeAttribute("src");
            video.load();
            resolve(meta);
        };
        video.preload = "metadata";
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => {
            const meta = { durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined };
            audio.onloadedmetadata = audio.onerror = null;
            audio.removeAttribute("src");
            audio.load();
            resolve(meta);
        };
        audio.preload = "metadata";
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteGenerationHistoryRecords, persistGenerationHistoryRecord, synchronizeGenerationHistory } from "@/services/generation-history";
import type { VideoGenerationLog as GenerationLog, VideoLogConfig as GenerationLogConfig } from "./video-task-model";

let logStorePromise: Promise<ReturnType<(typeof import("localforage"))["createInstance"]>> | undefined;

function getLogStore() {
    if (!logStorePromise) {
        logStorePromise = import("localforage").then(({ default: localforage }) => localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" }));
    }
    return logStorePromise;
}

function normalizeResolution(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (["720p", "auto", "high", "medium"].includes(value)) return "720";
    return value.replace(/p$/i, "") || "720";
}

export async function normalizeVideoLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        ...log,
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        updatedAt: log.updatedAt || log.createdAt || Date.now(),
        ownerUserId: log.ownerUserId,
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task && log.ownerUserId && log.ownerUserId !== "local" ? { ...log.task, ownerUserId: log.ownerUserId } : log.task,
        video,
        error: log.error,
    };
}

export async function prepareVideoLogForServer(log: GenerationLog, expectedUserId: string): Promise<GenerationLog> {
    const references = await Promise.all(
        log.references.map(async (item) => {
            if (item.storageKey || !item.dataUrl) return item;
            const stored = await uploadImage(item.dataUrl, { expectedUserId });
            return { ...item, dataUrl: stored.url, storageKey: stored.storageKey, type: stored.mimeType };
        }),
    );
    const videoReferences = await Promise.all(
        log.videoReferences.map(async (item) => {
            if (item.storageKey || !item.url) return item;
            const stored = await uploadMediaFile(item.url, "video-reference", expectedUserId);
            return { ...item, url: stored.url, storageKey: stored.storageKey, type: stored.mimeType, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs };
        }),
    );
    const audioReferences = await Promise.all(
        log.audioReferences.map(async (item) => {
            if (item.storageKey || !item.url) return item;
            const stored = await uploadMediaFile(item.url, "audio-reference", expectedUserId);
            return { ...item, url: stored.url, storageKey: stored.storageKey, type: stored.mimeType, durationMs: stored.durationMs };
        }),
    );
    const video =
        log.video && !log.video.storageKey && log.video.url
            ? await uploadMediaFile(log.video.url, "video", expectedUserId).then((stored) => ({
                  ...log.video!,
                  url: stored.url,
                  storageKey: stored.storageKey,
                  bytes: stored.bytes,
                  mimeType: stored.mimeType,
                  width: stored.width || log.video!.width,
                  height: stored.height || log.video!.height,
              }))
            : log.video;
    return serializeVideoLog({ ...log, references, videoReferences, audioReferences, video });
}

export function serializeVideoLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode || "",
    };
}

async function historyOptions(userId: string) {
    const storage = await getLogStore();
    // An unowned browser record is not evidence of ownership in a public account.
    const store = {
        getItem: storage.getItem.bind(storage),
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
        iterate: <T, U>(callback: (value: T, key: string, iteration: number) => U) =>
            storage.iterate<T, U>((value, key, iteration) => {
                if (PUBLIC_MODE && (value as GenerationLog)?.ownerUserId !== userId) return undefined as U;
                return callback(value, key, iteration);
            }),
    };
    return { kind: "video" as const, userId, store, hydrate: normalizeVideoLog, prepare: prepareVideoLogForServer };
}
export async function loadVideoHistory(userId: string) {
    return synchronizeGenerationHistory(await historyOptions(userId));
}
export async function saveVideoHistory(log: GenerationLog, userId: string) {
    return persistGenerationHistoryRecord(await historyOptions(userId), serializeVideoLog(log));
}
export async function deleteVideoHistory(ids: string[], userId: string) {
    return deleteGenerationHistoryRecords(await historyOptions(userId), ids);
}

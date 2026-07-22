import { resolveOpenAiImageSize } from "./image-request";

export type UuImageAsyncTaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled" | "unknown";

export type UuImageAsyncTask = {
    taskId?: string;
    status: UuImageAsyncTaskStatus;
    expiresAt?: string;
    imageUrls: string[];
    message?: string;
};

export function isUuImageAsyncChannel(baseUrl: string, model: string, referenceCount: number, hasMask: boolean) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        const isUuHost = ["uuapi.cc", "uuapi.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        return isUuHost && model.trim().toLowerCase() === "gpt-image-2" && referenceCount <= 1 && !hasMask;
    } catch {
        return false;
    }
}

export function resolveUuAsyncImageSize(size?: string, quality?: string) {
    const resolved = resolveOpenAiImageSize(size, quality) || "1024x1024";
    const match = resolved.match(/^(\d+)x(\d+)$/i);
    if (!match) return { width: 1024, height: 1024 };
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : { width: 1024, height: 1024 };
}

export function buildUuAsyncImageRequest({ size, quality, referenceCount }: { size?: string; quality?: string; referenceCount: number }) {
    const { width, height } = resolveUuAsyncImageSize(size, quality);
    return { mode: referenceCount ? "image" : "text", width, height };
}

export function readUuAsyncTask(payload: unknown): UuImageAsyncTask {
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const task = asRecord(data?.task) || asRecord(root?.task) || data || root || {};
    const result = asRecord(task.result);
    const error = asRecord(task.error) || asRecord(data?.error) || asRecord(root?.error);
    const images = [task.images, result?.images, data?.images, root?.images].find(Array.isArray) || [];

    return {
        taskId: firstString(task.task_id, task.taskId, task.id, data?.task_id, data?.taskId, root?.task_id, root?.taskId),
        status: normalizeStatus(firstString(task.status, task.task_status, task.state, data?.status, root?.status)),
        expiresAt: firstString(task.expires_at, task.expiresAt, data?.expires_at, root?.expires_at),
        imageUrls: images.flatMap(readImageUrl),
        message: firstString(error?.message, error?.msg, task.message, task.msg, data?.message, data?.msg, root?.message, root?.msg),
    };
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function normalizeStatus(value?: string): UuImageAsyncTaskStatus {
    switch (value?.trim().toLowerCase()) {
        case "pending":
        case "queued":
        case "created":
            return "pending";
        case "running":
        case "processing":
            return "running";
        case "succeeded":
        case "success":
        case "completed":
        case "done":
            return "succeeded";
        case "failed":
        case "error":
            return "failed";
        case "canceled":
        case "cancelled":
            return "canceled";
        default:
            return "unknown";
    }
}

function readImageUrl(value: unknown) {
    if (typeof value === "string" && value.trim()) return [value.trim()];
    const image = asRecord(value);
    const url = firstString(image?.url, image?.image_url, image?.imageUrl);
    return url ? [url] : [];
}

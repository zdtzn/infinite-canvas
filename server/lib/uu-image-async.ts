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
    const nestedTask = asRecord(data?.task) || asRecord(root?.task) || asRecord(data?.job) || asRecord(root?.job);
    const task = nestedTask || data || root || {};
    const error = asRecord(task.error) || asRecord(data?.error) || asRecord(root?.error);
    const taskId = firstString(task.task_id, task.taskId, task.id, data?.task_id, data?.taskId, root?.task_id, root?.taskId);
    const imageUrls = collectImageUrls(task, data, root);
    const rawTaskStatus = firstString(task.task_status, task.taskStatus, task.state, task.task_state, task.taskState, task.status);
    const taskStatus = normalizeStatus(rawTaskStatus);
    const wrapperStatus = normalizeStatus(firstString(root?.status, root?.state));
    const taskHasOnlyGenericSuccess = rawTaskStatus?.toLowerCase() === "success" && !imageUrls.length;

    // Some UU responses use "success" only for the HTTP envelope. It must not
    // be mistaken for a completed image task before a task-level status exists.
    const status =
        taskStatus !== "unknown" && !taskHasOnlyGenericSuccess
            ? taskStatus
            : imageUrls.length
              ? "succeeded"
              : wrapperStatus === "failed" || wrapperStatus === "canceled"
                ? wrapperStatus
                : taskId
                  ? "pending"
                  : "unknown";

    return {
        taskId,
        status,
        expiresAt: firstString(task.expires_at, task.expiresAt, data?.expires_at, root?.expires_at),
        imageUrls,
        message: firstUsefulMessage(error?.message, error?.msg, task.message, task.msg, data?.message, data?.msg, root?.message, root?.msg),
    };
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstUsefulMessage(...values: unknown[]) {
    return values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
        .find((value) => !isGenericAcknowledgement(value));
}

function isGenericAcknowledgement(value: string) {
    return ["success", "succeeded", "ok", "completed", "done", "pending", "processing", "running", "created", "accepted"].includes(value.trim().toLowerCase());
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

function collectImageUrls(...records: Array<Record<string, unknown> | undefined>) {
    const urls = records.flatMap((record) =>
        record
            ? [
                  record.images,
                  record.image_urls,
                  record.imageUrls,
                  record.image_url,
                  record.imageUrl,
                  record.image,
                  record.results,
                  record.result,
                  record.output,
                  record.output_images,
                  record.outputImages,
              ].flatMap((value) => readImageUrl(value))
            : [],
    );
    return [...new Set(urls)];
}

function readImageUrl(value: unknown, depth = 0): string[] {
    if (depth > 4 || value === undefined || value === null) return [];
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (Array.isArray(value)) return value.flatMap((item) => readImageUrl(item, depth + 1));
    const image = asRecord(value);
    if (!image) return [];
    const url = firstString(image.url, image.image_url, image.imageUrl, image.file_url, image.fileUrl, image.download_url, image.downloadUrl);
    if (url) return [url];
    const base64 = firstString(image.b64_json, image.base64, image.data);
    if (base64) return [`data:${firstString(image.mime_type, image.mimeType) || "image/png"};base64,${base64}`];
    return [image.images, image.image_urls, image.imageUrls, image.image_url, image.imageUrl, image.image, image.results, image.result, image.output, image.data].flatMap((item) => readImageUrl(item, depth + 1));
}

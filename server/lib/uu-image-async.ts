import { normalizeImageResponseValue, resolveOpenAiImageSize } from "./image-request";
import { AsyncSemaphore } from "./async-semaphore";
import type { ImageJobInput } from "../types";

export type UuImageAsyncTaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled" | "unknown";

export type UuImageAsyncTask = {
    taskId?: string;
    status: UuImageAsyncTaskStatus;
    expiresAt?: string;
    imageUrls: string[];
    message?: string;
};

export class UuImageChannelScheduler {
    private readonly channels = new Map<string, AsyncSemaphore>();

    constructor(private readonly concurrency = 1) {}

    run<T>(channelId: string, signal: AbortSignal, operation: () => Promise<T> | T) {
        const key = channelId.trim() || "default";
        let semaphore = this.channels.get(key);
        if (!semaphore) {
            semaphore = new AsyncSemaphore(this.concurrency);
            this.channels.set(key, semaphore);
        }
        return semaphore.run(signal, operation);
    }
}

export function isUuAsyncGptImage2Channel(baseUrl: string, model: string) {
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        const isUuHost = ["uuapi.cc", "uuapi.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        return isUuHost && model.trim().toLowerCase() === "gpt-image-2";
    } catch {
        return false;
    }
}

export function isUuImageAsyncChannel(baseUrl: string, model: string, _referenceCount: number, hasMask: boolean) {
    return isUuAsyncGptImage2Channel(baseUrl, model) && !hasMask;
}

export function hasUuAsyncTask(input: ImageJobInput): input is ImageJobInput & {
    upstream: NonNullable<ImageJobInput["upstream"]>;
} {
    return input.upstream?.provider === "uu-image" && Boolean(input.upstream.taskId);
}

export function resolveUuAsyncImageSize(size?: string, quality?: string) {
    const resolved = resolveOpenAiImageSize(size, quality, "gpt-image-2") || "1024x1024";
    const match = resolved.match(/^(\d+)x(\d+)$/i);
    if (!match) return { width: 1024, height: 1024 };
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return { width: 1024, height: 1024 };
    return { width, height };
}

export function buildUuAsyncImageRequest({ size, quality, referenceCount }: { size?: string; quality?: string; referenceCount: number }) {
    const { width, height } = resolveUuAsyncImageSize(size, quality);
    return { mode: referenceCount ? "image" : "text", sizeTier: resolveUuAsyncImageSizeTier(width, height), width, height };
}

export function buildUuAsyncImageForm({
    model,
    prompt,
    size,
    quality,
    references,
}: {
    model: string;
    prompt: string;
    size?: string;
    quality?: string;
    references: Blob[];
}) {
    const request = buildUuAsyncImageRequest({ size, quality, referenceCount: references.length });
    const form = new FormData();
    form.set("model", model);
    form.set("mode", request.mode);
    form.set("prompt", prompt);
    form.set("size_tier", request.sizeTier);
    form.set("width", String(request.width));
    form.set("height", String(request.height));
    // Match UU Image Studio: send every reference through `images` and repeat
    // the first one as the legacy-compatible singular `image` field.
    references.forEach((reference, index) => {
        const filename = `reference-${index + 1}${imageFilenameExtension(reference.type)}`;
        form.append("images", reference, filename);
        if (index === 0) form.append("image", reference, filename);
    });
    return form;
}

function imageFilenameExtension(mimeType: string) {
    return (
        {
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "image/avif": ".avif",
        } as Record<string, string>
    )[mimeType.toLowerCase()] || ".png";
}

function resolveUuAsyncImageSizeTier(width: number, height: number): "1K" | "2K" | "4K" {
    const longestEdge = Math.max(width, height);
    if (longestEdge <= 1024) return "1K";
    if (longestEdge <= 2048) return "2K";
    return "4K";
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
        message: firstUsefulMessage(
            error?.message,
            error?.msg,
            task.error_message,
            task.errorMessage,
            task.fail_reason,
            task.failReason,
            task.failure_reason,
            task.failureReason,
            data?.error_message,
            data?.errorMessage,
            data?.fail_reason,
            data?.failReason,
            root?.error_message,
            root?.errorMessage,
            task.message,
            task.msg,
            data?.message,
            data?.msg,
            root?.message,
            root?.msg,
        ),
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
    if (typeof value === "string" && value.trim()) {
        try {
            return [normalizeImageResponseValue(value, "image/png")];
        } catch {
            return [];
        }
    }
    if (Array.isArray(value)) return value.flatMap((item) => readImageUrl(item, depth + 1));
    const image = asRecord(value);
    if (!image) return [];
    for (const candidate of [image.url, image.image_url, image.imageUrl, image.file_url, image.fileUrl, image.download_url, image.downloadUrl, image.b64_json, image.base64]) {
        if (typeof candidate !== "string" || !candidate.trim()) continue;
        try {
            return [normalizeImageResponseValue(candidate, firstString(image.mime_type, image.mimeType) || "image/png")];
        } catch {
            // Continue through alternate fields before treating the task as image-less.
        }
    }
    return [image.images, image.image_urls, image.imageUrls, image.image_url, image.imageUrl, image.image, image.results, image.result, image.output, image.data].flatMap((item) => readImageUrl(item, depth + 1));
}

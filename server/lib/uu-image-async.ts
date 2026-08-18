import { normalizeImageResponseValue } from "./image-request";
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

export class UuAsyncCapabilityRegistry {
    private readonly disabledChannels = new Set<string>();

    canSubmit(channelId: string) {
        return !this.disabledChannels.has(this.channelKey(channelId));
    }

    async runWithFallback<T>(channelId: string, asyncOperation: () => Promise<T>, syncOperation: () => Promise<T>) {
        const key = this.channelKey(channelId);
        if (this.disabledChannels.has(key)) return syncOperation();
        try {
            return await asyncOperation();
        } catch (error) {
            if (!isUuAsyncTasksDisabledError(error)) throw error;
            this.disabledChannels.add(key);
            return syncOperation();
        }
    }

    private channelKey(channelId: string) {
        return channelId.trim() || "default";
    }
}

export function isUuAsyncTasksDisabledError(value: unknown) {
    const message =
        value instanceof Error
            ? value.message
            : typeof value === "string"
              ? value
              : value && typeof value === "object" && "message" in value
                ? String((value as { message?: unknown }).message || "")
                : "";
    return (
        /async image tasks?\s+(?:are|is)\s+(?:not enabled|disabled)\b/i.test(message) ||
        /异步(?:图片|生图)?任务[^。；;]*(?:未启用|未开启|已禁用|不支持)/i.test(message) ||
        /(?:upstream service returned|上游服务返回)\s*404\b|404\s+(?:page\s+)?not found/i.test(message)
    );
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

export function isUuImageAsyncChannel(baseUrl: string, model: string, referenceCount: number, hasMask: boolean) {
    return isUuAsyncGptImage2Channel(baseUrl, model) && referenceCount <= 1 && !hasMask;
}

export function hasUuAsyncTask(input: ImageJobInput): input is ImageJobInput & {
    upstream: NonNullable<ImageJobInput["upstream"]>;
} {
    return input.upstream?.provider === "uu-image" && Boolean(input.upstream.taskId);
}

export function resolveUuAsyncImageSize(size?: string, quality?: string) {
    const ratio = !size || size === "auto" ? "1:1" : size.trim();
    const resolution = !quality || quality === "auto" ? "low" : quality.trim().toLowerCase();
    const resolved = UU_IMAGE_SIZES[resolution]?.[ratio];
    if (!resolved) throw new Error(`UU GPT Image 2 不支持 ${ratio} / ${resolution} 组合`);
    const [width, height] = resolved.split("x").map(Number);
    return { width, height };
}

export function buildUuAsyncImageSubmission({
    model,
    prompt,
    size,
    resolution,
    generationQuality,
    references,
}: {
    model: string;
    prompt: string;
    size?: string;
    resolution?: string;
    generationQuality?: string;
    references: Blob[];
}) {
    if (references.length > 1) throw new Error("UU GPT Image 2 当前最多支持 1 张参考图");
    const { width, height } = resolveUuAsyncImageSize(size, resolution);
    const outputSize = `${width}x${height}`;
    const quality = resolveUuGenerationQuality(generationQuality);
    if (!references.length) {
        return {
            path: "/images/generations/async" as const,
            contentType: "application/json" as const,
            body: JSON.stringify({ model, prompt, size: outputSize, quality }),
        };
    }

    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", outputSize);
    form.set("quality", quality);
    const reference = references[0];
    form.set("image", reference, `reference-1${imageFilenameExtension(reference.type)}`);
    return { path: "/images/edits/async" as const, contentType: undefined, body: form };
}

export function buildUuAsyncTaskPath(taskId: string) {
    return `/images/tasks/${encodeURIComponent(taskId)}`;
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

function resolveUuGenerationQuality(quality?: string) {
    const normalized = quality?.trim().toLowerCase() || "medium";
    if (["auto", "medium", "high"].includes(normalized)) return normalized;
    throw new Error(`UU GPT Image 2 不支持 ${normalized} 生成质量`);
}

const UU_IMAGE_SIZES: Record<string, Record<string, string>> = {
    low: { "1:1": "1024x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1024x576" },
    medium: { "1:1": "2048x2048", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152" },
    high: { "1:1": "4096x4096", "4:3": "4096x3072", "3:4": "3072x4096", "16:9": "3840x2160" },
};

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

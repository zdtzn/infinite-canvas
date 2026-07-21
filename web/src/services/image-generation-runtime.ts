import { nanoid } from "nanoid";

import { requestEdit, requestGeneration } from "@/services/api/image";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

export type ImageGenerationSnapshot = {
    text: string;
    config: AiConfig;
    references: ReferenceImage[];
};

export type ImageGenerationJob = {
    id: string;
    prompt: string;
    references: ReferenceImage[];
    status: "running" | "succeeded" | "failed";
    results: GenerationResult[];
    startedAt: number;
    elapsedMs: number;
    successCount: number;
    failCount: number;
    error?: string;
};

export type ImageGenerationCompletion = {
    successImages: GeneratedImage[];
    successCount: number;
    failCount: number;
    error?: string;
    durationMs: number;
};

type CompletionHandler = (completion: ImageGenerationCompletion) => void | Promise<void>;
type SlotRunner = (snapshot: ImageGenerationSnapshot, index: number) => Promise<GeneratedImage>;

let currentJob: ImageGenerationJob | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

export function subscribeImageGeneration(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getImageGenerationSnapshot() {
    return currentJob;
}

export function startImageGeneration(snapshot: ImageGenerationSnapshot, count: number, onComplete?: CompletionHandler, slotRunner: SlotRunner = requestImageSlot) {
    if (currentJob?.status === "running") return null;

    const startedAt = Date.now();
    const job: ImageGenerationJob = {
        id: nanoid(),
        prompt: snapshot.text,
        references: [...snapshot.references],
        status: "running",
        results: Array.from({ length: count }, () => ({ id: nanoid(), status: "pending" })),
        startedAt,
        elapsedMs: 0,
        successCount: 0,
        failCount: 0,
    };
    currentJob = job;
    startElapsedTimer();
    emit();

    void runGeneration(job.id, snapshot, onComplete, slotRunner);
    return job.id;
}

export async function retryImageGeneration(index: number, snapshot: ImageGenerationSnapshot) {
    const job = currentJob;
    if (!job || job.status === "running") return null;

    updateResult(job.id, index, { status: "pending", error: undefined, image: undefined });
    try {
        const image = await runGenerationSlot(job.id, index, snapshot);
        return image;
    } catch {
        return null;
    }
}

export function clearImageGenerationJob() {
    if (currentJob?.status === "running") return false;
    currentJob = null;
    emit();
    return true;
}

async function runGeneration(jobId: string, snapshot: ImageGenerationSnapshot, onComplete: CompletionHandler | undefined, slotRunner: SlotRunner) {
    const job = currentJob;
    if (!job || job.id !== jobId) return;

    const tasks = job.results.map((_, index) => runGenerationSlot(jobId, index, snapshot, slotRunner));
    const settled = await Promise.allSettled(tasks);
    const successImages = settled.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
    const successCount = successImages.length;
    const failCount = settled.length - successCount;
    const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? "生成失败" : undefined;
    const durationMs = Date.now() - job.startedAt;

    stopElapsedTimer();
    if (currentJob?.id === jobId) {
        currentJob = {
            ...currentJob,
            status: successCount ? "succeeded" : "failed",
            elapsedMs: durationMs,
            successCount,
            failCount,
            error,
        };
        emit();
    }

    try {
        await onComplete?.({ successImages, successCount, failCount, error, durationMs });
    } catch {
        // Persisting a completed result must not turn a successful generation into a failed task.
    }
}

async function runGenerationSlot(jobId: string, index: number, snapshot: ImageGenerationSnapshot, slotRunner: SlotRunner = requestImageSlot) {
    try {
        const nextImage = await slotRunner(snapshot, index);
        updateResult(jobId, index, { status: "success", image: nextImage });
        return nextImage;
    } catch (error) {
        updateResult(jobId, index, { status: "failed", error: error instanceof Error ? error.message : "生成失败" });
        throw error;
    }
}

async function requestImageSlot(snapshot: ImageGenerationSnapshot) {
    const itemStartedAt = Date.now();
    const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
    const image = result[0];
    if (!image) throw new Error("接口没有返回图片");
    const meta = await readImageMeta(image.dataUrl);
    return {
        id: image.id,
        dataUrl: image.dataUrl,
        durationMs: Date.now() - itemStartedAt,
        width: meta.width,
        height: meta.height,
        bytes: getDataUrlByteSize(image.dataUrl),
    };
}

function updateResult(jobId: string, index: number, next: Partial<GenerationResult>) {
    if (!currentJob || currentJob.id !== jobId) return;
    currentJob = { ...currentJob, results: currentJob.results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item)) };
    emit();
}

function startElapsedTimer() {
    stopElapsedTimer();
    elapsedTimer = setInterval(() => {
        if (!currentJob || currentJob.status !== "running") return;
        currentJob = { ...currentJob, elapsedMs: Date.now() - currentJob.startedAt };
        emit();
    }, 1000);
}

function stopElapsedTimer() {
    if (!elapsedTimer) return;
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
}

function emit() {
    listeners.forEach((listener) => listener());
}

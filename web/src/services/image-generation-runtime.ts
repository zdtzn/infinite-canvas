import { nanoid } from "nanoid";
import localforage from "localforage";

import { requestEdit, requestGeneration } from "@/services/api/image";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { fetchServerJob, waitForServerJob } from "@/services/server-api";
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
    serverJobId?: string;
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
    snapshot?: ImageGenerationSnapshot;
};

export type ImageGenerationCompletion = {
    successImages: GeneratedImage[];
    successCount: number;
    failCount: number;
    error?: string;
    durationMs: number;
};

type CompletionHandler = (completion: ImageGenerationCompletion) => void | Promise<void>;
type SlotRunner = (snapshot: ImageGenerationSnapshot, index: number, onServerJobCreated?: (jobId: string) => void) => Promise<GeneratedImage>;

let currentJob: ImageGenerationJob | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const runtimeStore = localforage.createInstance({ name: "infinite-canvas", storeName: "generation_runtime" });
const RUNTIME_JOB_KEY = "active-image-job:v1";
let hydrationStarted = false;

export function subscribeImageGeneration(listener: () => void) {
    hydrateRuntime();
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getImageGenerationSnapshot() {
    hydrateRuntime();
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
        snapshot,
    };
    currentJob = job;
    startElapsedTimer();
    emit();
    persistCurrentJob();

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
    if (typeof window !== "undefined") void runtimeStore.removeItem(RUNTIME_JOB_KEY);
    return true;
}

async function runGeneration(jobId: string, snapshot: ImageGenerationSnapshot, onComplete: CompletionHandler | undefined, slotRunner: SlotRunner) {
    const job = currentJob;
    if (!job || job.id !== jobId) return;

    const tasks = job.results.map((result, index) => (result.status === "success" ? Promise.resolve(result.image!) : runGenerationSlot(jobId, index, snapshot, slotRunner)));
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
        persistCurrentJob();
    }

    try {
        await onComplete?.({ successImages, successCount, failCount, error, durationMs });
    } catch {
        // Persisting a completed result must not turn a successful generation into a failed task.
    }
}

async function runGenerationSlot(jobId: string, index: number, snapshot: ImageGenerationSnapshot, slotRunner: SlotRunner = requestImageSlot) {
    try {
        const existingServerJobId = currentJob?.id === jobId ? currentJob.results[index]?.serverJobId : undefined;
        const nextImage = existingServerJobId ? await restoreServerImage(existingServerJobId) : await slotRunner(snapshot, index, (serverJobId) => updateResult(jobId, index, { serverJobId }));
        updateResult(jobId, index, { status: "success", image: nextImage });
        return nextImage;
    } catch (error) {
        updateResult(jobId, index, { status: "failed", error: error instanceof Error ? error.message : "生成失败" });
        throw error;
    }
}

async function requestImageSlot(snapshot: ImageGenerationSnapshot, _index?: number, onServerJobCreated?: (jobId: string) => void) {
    const itemStartedAt = Date.now();
    const result = snapshot.references.length
        ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, undefined, { onJobCreated: onServerJobCreated, source: { route: "/image", label: "生图工作台" } })
        : await requestGeneration(snapshot.config, snapshot.text, { onJobCreated: onServerJobCreated, source: { route: "/image", label: "生图工作台" } });
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
    persistCurrentJob();
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

async function restoreServerImage(serverJobId: string) {
    const current = await fetchServerJob(serverJobId);
    const job = current.job.status === "succeeded" ? current.job : await waitForServerJob(serverJobId);
    const image = job.result?.images[0];
    if (!image) throw new Error(job.error || "任务没有返回图片");
    const meta = await readImageMeta(image.dataUrl);
    return { id: image.id, dataUrl: image.dataUrl, durationMs: image.durationMs || job.result?.durationMs || 0, width: meta.width, height: meta.height, bytes: image.bytes || getDataUrlByteSize(image.dataUrl), mimeType: image.mimeType };
}

function hydrateRuntime() {
    if (hydrationStarted || typeof window === "undefined") return;
    hydrationStarted = true;
    void runtimeStore.getItem<ImageGenerationJob>(RUNTIME_JOB_KEY).then((saved) => {
        if (!saved || currentJob) return;
        currentJob = saved;
        emit();
        if (saved.status === "running" && saved.snapshot) {
            startElapsedTimer();
            void runGeneration(saved.id, saved.snapshot, undefined, requestImageSlot);
        }
    });
}

function persistCurrentJob() {
    if (typeof window === "undefined" || !currentJob) return;
    const persisted: ImageGenerationJob = {
        ...currentJob,
        references: currentJob.references.map(stripReferenceData),
        snapshot: currentJob.snapshot
            ? {
                  ...currentJob.snapshot,
                  references: currentJob.snapshot.references.map(stripReferenceData),
                  config: {
                      ...currentJob.snapshot.config,
                      apiKey: "",
                      channels: currentJob.snapshot.config.channels.map((channel) => ({ ...channel, apiKey: "" })),
                  },
              }
            : undefined,
    };
    void runtimeStore.setItem(RUNTIME_JOB_KEY, persisted);
}

function stripReferenceData(reference: ReferenceImage): ReferenceImage {
    return reference.storageKey ? { ...reference, dataUrl: "" } : reference;
}

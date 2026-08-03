import { nanoid } from "nanoid";
import localforage from "localforage";

import { requestEdit, requestGeneration } from "@/services/api/image";
import { settleWithConcurrency } from "@/lib/async-pool";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { fetchServerJob, retryServerJob, waitForServerJob } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    serverJobId?: string;
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
    idempotencyKey?: string;
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
    slotConcurrency?: number;
};

export type ImageGenerationCompletion = {
    successImages: GeneratedImage[];
    successCount: number;
    failCount: number;
    error?: string;
    durationMs: number;
};

type CompletionHandler = (completion: ImageGenerationCompletion) => void | Promise<void>;
type SlotRunner = (snapshot: ImageGenerationSnapshot, index: number, onServerJobCreated?: (jobId: string) => void, expectedUserId?: string, idempotencyKey?: string) => Promise<GeneratedImage>;

let currentJob: ImageGenerationJob | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const runtimeStore = localforage.createInstance({ name: "infinite-canvas", storeName: "generation_runtime" });
const RUNTIME_JOB_KEY = "active-image-job:v1";
const RUNTIME_JOB_KEY_PREFIX = "active-image-job:v2:";
let runtimeOwnerUserId = PUBLIC_MODE ? useUserStore.getState().user?.id || "" : "local";
let hydrationStarted = false;
let hydrationVersion = 0;
let runtimePersistence = Promise.resolve();

export function prepareImageGenerationRuntimeForUser(userId: string) {
    const nextOwnerUserId = PUBLIC_MODE ? userId.trim() : "local";
    if (runtimeOwnerUserId === nextOwnerUserId) return;
    runtimeOwnerUserId = nextOwnerUserId;
    hydrationVersion += 1;
    hydrationStarted = false;
    stopElapsedTimer();
    currentJob = null;
    emit();
    hydrateRuntime();
}

export function subscribeImageGeneration(listener: () => void) {
    hydrateRuntime();
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getImageGenerationSnapshot() {
    hydrateRuntime();
    return currentJob;
}

export function startImageGeneration(snapshot: ImageGenerationSnapshot, count: number, onComplete?: CompletionHandler, slotRunner: SlotRunner = requestImageSlot, slotConcurrency = count) {
    if (currentJob?.status === "running") return null;

    const startedAt = Date.now();
    const normalizedSlotConcurrency = Math.max(1, Math.min(count, Math.floor(slotConcurrency) || 1));
    const job: ImageGenerationJob = {
        id: nanoid(),
        prompt: snapshot.text,
        references: [...snapshot.references],
        status: "running",
        results: Array.from({ length: count }, () => ({ id: nanoid(), status: "pending", idempotencyKey: nanoid() })),
        startedAt,
        elapsedMs: 0,
        successCount: 0,
        failCount: 0,
        snapshot,
        slotConcurrency: normalizedSlotConcurrency,
    };
    currentJob = job;
    startElapsedTimer();
    emit();
    persistCurrentJob();

    void runGeneration(job.id, snapshot, onComplete, slotRunner, runtimeOwnerUserId, hydrationVersion, normalizedSlotConcurrency);
    return job.id;
}

export async function retryImageGeneration(index: number, snapshot: ImageGenerationSnapshot) {
    const job = currentJob;
    if (!job || job.status === "running") return null;
    const ownerUserId = runtimeOwnerUserId;
    const ownerVersion = hydrationVersion;

    updateResult(job.id, index, { status: "pending", error: undefined, image: undefined });
    try {
        const image = await runGenerationSlot(job.id, index, snapshot, requestImageSlot, ownerUserId, true);
        return runtimeOwnerUserId === ownerUserId && hydrationVersion === ownerVersion ? image : null;
    } catch {
        return null;
    }
}

export function clearImageGenerationJob() {
    if (currentJob?.status === "running") return false;
    const key = runtimeJobKey();
    currentJob = null;
    emit();
    if (typeof window !== "undefined") {
        const operation = runtimePersistence.then(() => runtimeStore.removeItem(key));
        runtimePersistence = operation.catch(() => undefined);
    }
    return true;
}

/** Replace a temporary upstream URL after the final image file has been persisted. */
export function replaceImageGenerationResult(image: GeneratedImage) {
    if (!currentJob) return false;
    let replaced = false;
    const results = currentJob.results.map((result) => {
        if (result.image?.id !== image.id) return result;
        replaced = true;
        return { ...result, image };
    });
    if (!replaced) return false;
    currentJob = { ...currentJob, results };
    emit();
    persistCurrentJob();
    return true;
}

async function runGeneration(
    jobId: string,
    snapshot: ImageGenerationSnapshot,
    onComplete: CompletionHandler | undefined,
    slotRunner: SlotRunner,
    ownerUserId: string,
    ownerVersion: number,
    slotConcurrency: number,
) {
    const job = currentJob;
    if (!job || job.id !== jobId) return;

    const settled = await settleWithConcurrency(job.results, slotConcurrency, (result, index) =>
        result.status === "success" ? Promise.resolve(result.image!) : runGenerationSlot(jobId, index, snapshot, slotRunner, ownerUserId),
    );
    const successImages = settled.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
    const successCount = successImages.length;
    const failCount = settled.length - successCount;
    const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    const error = failed ? friendlyErrorMessage(failed.reason) : failCount ? "生成失败" : undefined;
    const durationMs = Date.now() - job.startedAt;

    if (runtimeOwnerUserId !== ownerUserId || hydrationVersion !== ownerVersion) return;
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

async function runGenerationSlot(
    jobId: string,
    index: number,
    snapshot: ImageGenerationSnapshot,
    slotRunner: SlotRunner = requestImageSlot,
    expectedUserId = runtimeOwnerUserId,
    retryExistingServerJob = false,
) {
    try {
        const currentResult = currentJob?.id === jobId ? currentJob.results[index] : undefined;
        const existingServerJobId = currentResult?.serverJobId;
        const idempotencyKey = currentResult?.idempotencyKey || nanoid();
        if (!currentResult?.idempotencyKey) updateResult(jobId, index, { idempotencyKey });
        await persistCurrentJob();
        let serverJobId = existingServerJobId;
        const nextImage = existingServerJobId
            ? retryExistingServerJob && PUBLIC_MODE
                ? await retryServerImage(existingServerJobId, idempotencyKey, expectedUserId, (createdJobId) => {
                      serverJobId = createdJobId;
                      updateResult(jobId, index, { serverJobId: createdJobId });
                  })
                : await restoreServerImage(existingServerJobId, expectedUserId)
            : await slotRunner(snapshot, index, (createdJobId) => {
                  serverJobId = createdJobId;
                  updateResult(jobId, index, { serverJobId: createdJobId });
              }, expectedUserId, idempotencyKey);
        const persistedImage = serverJobId ? { ...nextImage, serverJobId } : nextImage;
        updateResult(jobId, index, { status: "success", image: persistedImage });
        return persistedImage;
    } catch (error) {
        updateResult(jobId, index, { status: "failed", error: friendlyErrorMessage(error) });
        throw error;
    }
}

async function requestImageSlot(snapshot: ImageGenerationSnapshot, _index?: number, onServerJobCreated?: (jobId: string) => void, expectedUserId?: string, idempotencyKey?: string) {
    const itemStartedAt = Date.now();
    const result = snapshot.references.length
        ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, undefined, { onJobCreated: onServerJobCreated, source: { route: "/image", label: "生图工作台" }, expectedUserId, idempotencyKey })
        : await requestGeneration(snapshot.config, snapshot.text, { onJobCreated: onServerJobCreated, source: { route: "/image", label: "生图工作台" }, expectedUserId, idempotencyKey });
    const image = result[0];
    if (!image) throw new Error("接口没有返回图片");
    const meta = await resolveGeneratedImageMeta(image);
    return {
        id: image.id,
        dataUrl: image.dataUrl,
        durationMs: image.durationMs || Date.now() - itemStartedAt,
        width: meta.width,
        height: meta.height,
        bytes: image.bytes || getDataUrlByteSize(image.dataUrl),
        mimeType: image.mimeType || meta.mimeType,
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

async function restoreServerImage(serverJobId: string, expectedUserId: string) {
    const current = await fetchServerJob(serverJobId, expectedUserId);
    const job = current.job.status === "succeeded" ? current.job : await waitForServerJob(serverJobId, { expectedUserId });
    const image = job.result?.images[0];
    if (!image) throw new Error(job.error || "任务没有返回图片");
    const meta = await resolveGeneratedImageMeta(image);
    return { id: image.id, dataUrl: image.dataUrl, durationMs: image.durationMs || job.result?.durationMs || 0, width: meta.width, height: meta.height, bytes: image.bytes || getDataUrlByteSize(image.dataUrl), mimeType: image.mimeType };
}

async function retryServerImage(serverJobId: string, idempotencyKey: string, expectedUserId: string, onServerJobCreated: (jobId: string) => void) {
    const { job } = await retryServerJob(serverJobId, expectedUserId, idempotencyKey);
    onServerJobCreated(job.id);
    return restoreServerImage(job.id, expectedUserId);
}

async function resolveGeneratedImageMeta(image: { dataUrl: string; width?: number; height?: number; mimeType?: string }) {
    if (Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && (image.width || 0) > 0 && (image.height || 0) > 0) {
        return { width: image.width!, height: image.height!, mimeType: image.mimeType || "image/png" };
    }
    return readImageMeta(image.dataUrl);
}

function hydrateRuntime() {
    if (hydrationStarted || typeof window === "undefined" || !runtimeOwnerUserId) return;
    hydrationStarted = true;
    const ownerUserId = runtimeOwnerUserId;
    const version = hydrationVersion;
    void runtimeStore.getItem<ImageGenerationJob>(runtimeJobKey(ownerUserId)).then((saved) => {
        if (version !== hydrationVersion || ownerUserId !== runtimeOwnerUserId || !saved || currentJob) return;
        currentJob = saved;
        emit();
        if (saved.status === "running" && saved.snapshot) {
            startElapsedTimer();
            void runGeneration(saved.id, saved.snapshot, undefined, requestImageSlot, ownerUserId, version, saved.slotConcurrency || saved.results.length);
        }
    });
}

function persistCurrentJob() {
    if (typeof window === "undefined" || !currentJob || !runtimeOwnerUserId) return Promise.resolve();
    const key = runtimeJobKey();
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
    const operation = runtimePersistence.then(() => runtimeStore.setItem(key, persisted).then(() => undefined));
    runtimePersistence = operation.catch(() => undefined);
    return operation;
}

function runtimeJobKey(ownerUserId = runtimeOwnerUserId) {
    return PUBLIC_MODE ? `${RUNTIME_JOB_KEY_PREFIX}${encodeURIComponent(ownerUserId)}` : RUNTIME_JOB_KEY;
}

function stripReferenceData(reference: ReferenceImage): ReferenceImage {
    return reference.storageKey ? { ...reference, dataUrl: "" } : reference;
}

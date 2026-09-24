import { nanoid } from "nanoid";
import localforage from "localforage";

import { requestEdit, requestGeneration } from "@/services/api/image";
import { settleWithConcurrency } from "@/lib/async-pool";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { archiveDeferredServerJob, cancelServerJob, fetchServerJob, retryServerJob, waitForServerJob, type ServerJob, type ServerJobImage } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    serverJobId?: string;
    dataUrl: string;
    storageKey?: string;
    thumbnailKey?: string;
    thumbnailUrl?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    persisted?: boolean;
    expiresAt?: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "canceled";
    startedAt?: number;
    cancelRequested?: boolean;
    cancelError?: string;
    image?: GeneratedImage;
    error?: string;
    serverJobId?: string;
    idempotencyKey?: string;
    retryOfServerJobId?: string;
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
    status: "running" | "succeeded" | "failed" | "canceled";
    results: GenerationResult[];
    startedAt: number;
    elapsedMs: number;
    successCount: number;
    failCount: number;
    error?: string;
    snapshot?: ImageGenerationSnapshot;
    slotConcurrency?: number;
    concurrencyLimit?: number;
};

export type ImageGenerationCompletion = {
    successImages: GeneratedImage[];
    successCount: number;
    failCount: number;
    canceledCount?: number;
    error?: string;
    durationMs: number;
};

type CompletionHandler = (completion: ImageGenerationCompletion) => void | Promise<void>;
type SlotRunner = (
    snapshot: ImageGenerationSnapshot,
    index: number,
    onServerJobCreated?: (jobId: string) => void,
    expectedUserId?: string,
    idempotencyKey?: string,
    onServerJobArchived?: (job: ServerJob) => void,
    signal?: AbortSignal,
) => Promise<GeneratedImage>;

let jobs: ImageGenerationJob[] = [];
let selectedJobId: string | null = null;
let selectionVersion = 0;
const controllers = new Map<string, AbortController>();
const cancellations = new Map<string, Promise<void>>();
const activeSlots = new Set<string>();
const slotWaiters = new Set<() => void>();
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const runtimeStore = localforage.createInstance({ name: "infinite-canvas", storeName: "generation_runtime" });
const RUNTIME_JOB_KEY = "active-image-job:v1";
const RUNTIME_JOB_KEY_PREFIX = "active-image-job:v2:";
const RUNTIME_JOBS_KEY_PREFIX = "image-jobs:v3:";
const RECENT_COMPLETED_JOB_LIMIT = 20;
let runtimeOwnerUserId = PUBLIC_MODE ? useUserStore.getState().user?.id || "" : "local";
let hydrationStarted = false;
let hydrationVersion = 0;
let runtimePersistence = Promise.resolve();
let hydrationPromise = Promise.resolve();

export function prepareImageGenerationRuntimeForUser(userId: string) {
    const nextOwnerUserId = PUBLIC_MODE ? userId.trim() : "local";
    if (runtimeOwnerUserId === nextOwnerUserId) return;
    runtimeOwnerUserId = nextOwnerUserId;
    hydrationVersion += 1;
    hydrationStarted = false;
    stopElapsedTimer();
    jobs = [];
    selectedJobId = null;
    selectionVersion += 1;
    // Disconnect local polling only; server jobs remain recoverable for their original account.
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    activeSlots.clear();
    wakeSlotWaiters();
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
    return jobs.find((job) => job.id === selectedJobId) || null;
}

export function getImageGenerationJobsSnapshot() {
    hydrateRuntime();
    return jobs;
}

export function selectImageGenerationJob(id: string | null) {
    if (id && !jobs.some((job) => job.id === id)) return;
    selectedJobId = id;
    selectionVersion += 1;
    emit();
    void persistCurrentJob();
}

export function startImageGeneration(snapshot: ImageGenerationSnapshot, count: number, onComplete?: CompletionHandler, slotRunner: SlotRunner = requestImageSlot, slotConcurrency = count, concurrencyLimit = 10) {
    if (!Number.isInteger(count) || count < 1 || count > 10) return null;
    snapshot = structuredClone(snapshot);

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
        concurrencyLimit: Math.max(1, Math.floor(concurrencyLimit) || 1),
    };
    jobs = [...jobs, job];
    selectedJobId = job.id;
    selectionVersion += 1;
    startElapsedTimer();
    emit();
    persistCurrentJob();

    void runGeneration(job.id, snapshot, onComplete, slotRunner, runtimeOwnerUserId, hydrationVersion, normalizedSlotConcurrency);
    return job.id;
}

export async function retryImageGeneration(index: number, snapshot: ImageGenerationSnapshot) {
    const job = getImageGenerationSnapshot();
    if (!job || job.status === "running" || !["failed", "canceled"].includes(job.results[index]?.status)) return null;
    const ownerUserId = runtimeOwnerUserId;
    const ownerVersion = hydrationVersion;
    const previous = job.results[index];
    // A lost submission response may already have created a paid job. Replay its key to recover it.
    const idempotencyKey = previous.status === "failed" && !previous.serverJobId ? previous.idempotencyKey || nanoid() : nanoid();

    updateJob(job.id, { status: "running", error: undefined });
    updateResult(job.id, index, {
        status: "pending",
        error: undefined,
        image: undefined,
        startedAt: undefined,
        cancelRequested: false,
        cancelError: undefined,
        idempotencyKey,
        retryOfServerJobId: job.results[index].serverJobId || job.results[index].retryOfServerJobId,
        serverJobId: undefined,
    });
    startElapsedTimer();
    try {
        const image = await runGenerationSlot(job.id, index, snapshot, requestImageSlot, ownerUserId);
        return runtimeOwnerUserId === ownerUserId && hydrationVersion === ownerVersion ? image : null;
    } catch {
        return null;
    } finally {
        if (runtimeOwnerUserId === ownerUserId && hydrationVersion === ownerVersion) finishJob(job.id);
    }
}

export function clearImageGenerationJob() {
    const currentJob = getImageGenerationSnapshot();
    if (currentJob?.status === "running") return false;
    jobs = jobs.filter((job) => job.id !== selectedJobId);
    selectImageGenerationJob(null);
    return true;
}

/** Confirm server cancellation before stopping polling; a failed cancellation leaves the task recoverable. */
export async function cancelImageGeneration(jobId: string, index?: number) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    const settled = await Promise.allSettled(job.results.map((result, slotIndex) => (result.status === "pending" && (index === undefined || index === slotIndex) ? cancelSlot(jobId, slotIndex) : Promise.resolve())));
    const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failed) throw failed.reason;
}

function cancelSlot(jobId: string, index: number): Promise<void> {
    const result = jobs.find((job) => job.id === jobId)?.results[index];
    if (!result || result.status !== "pending") return Promise.resolve();
    const existing = cancellations.get(result.id);
    if (existing) return existing;
    updateResult(jobId, index, { cancelRequested: true, cancelError: undefined });
    const controller = controllers.get(result.id);
    if (!PUBLIC_MODE || (!result.startedAt && !result.serverJobId)) {
        updateResult(jobId, index, { status: "canceled", cancelRequested: false });
        controller?.abort();
        wakeSlotWaiters();
        return Promise.resolve();
    }
    // Submission may still be returning its ID. onJobCreated will perform the cancellation.
    if (!result.serverJobId) return Promise.resolve();
    const owner = runtimeOwnerUserId;
    const version = hydrationVersion;
    const operation = cancelServerJob(result.serverJobId, owner)
        .then(({ job }) => {
            if (owner !== runtimeOwnerUserId || version !== hydrationVersion) return;
            const current = jobs.find((item) => item.id === jobId)?.results[index];
            if (current?.status !== "pending") return;
            if (job.status === "canceled") {
                updateResult(jobId, index, { status: "canceled", cancelRequested: false });
                controller?.abort();
            } else if (job.status === "succeeded" || job.status === "failed") {
                updateResult(jobId, index, { cancelRequested: false });
            } else {
                throw new Error("服务端尚未取消任务，请稍后重试");
            }
        })
        .catch((error) => {
            if (owner === runtimeOwnerUserId && version === hydrationVersion) updateResult(jobId, index, { cancelRequested: false, cancelError: `取消失败：${friendlyErrorMessage(error)}，任务仍在继续` });
            throw error;
        })
        .finally(() => cancellations.delete(result.id));
    cancellations.set(result.id, operation);
    return operation;
}

/** Replace a temporary upstream URL after the final image file has been persisted. */
export function replaceImageGenerationResult(image: GeneratedImage) {
    let replaced = false;
    jobs = jobs.map((job) => ({
        ...job,
        results: job.results.map((result) => {
            if (result.image?.id !== image.id) return result;
            replaced = true;
            return { ...result, image };
        }),
    }));
    if (!replaced) return false;
    emit();
    persistCurrentJob();
    return true;
}

async function runGeneration(jobId: string, snapshot: ImageGenerationSnapshot, onComplete: CompletionHandler | undefined, slotRunner: SlotRunner, ownerUserId: string, ownerVersion: number, slotConcurrency: number) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;

    await settleWithConcurrency(job.results, slotConcurrency, (_result, index) => {
        if (runtimeOwnerUserId !== ownerUserId || hydrationVersion !== ownerVersion) throw new DOMException("Aborted", "AbortError");
        const current = jobs.find((item) => item.id === jobId)?.results[index];
        return current?.status === "pending" ? runGenerationSlot(jobId, index, snapshot, slotRunner, ownerUserId) : Promise.resolve(current?.image);
    });

    if (runtimeOwnerUserId !== ownerUserId || hydrationVersion !== ownerVersion) return;
    const completion = finishJob(jobId);

    try {
        if (completion) await onComplete?.(completion);
    } catch {
        // Persisting a completed result must not turn a successful generation into a failed task.
    }
}

function finishJob(jobId: string): ImageGenerationCompletion | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    const successImages = job.results.flatMap((result) => (result.status === "success" && result.image ? [result.image] : []));
    const successCount = successImages.length;
    const failCount = job.results.filter((result) => result.status === "failed").length;
    const canceledCount = job.results.filter((result) => result.status === "canceled").length;
    const error = job.results.find((result) => result.status === "failed")?.error;
    const durationMs = Date.now() - job.startedAt;
    updateJob(jobId, { status: successCount ? "succeeded" : failCount ? "failed" : "canceled", successCount, failCount, elapsedMs: durationMs, error });
    if (!jobs.some((item) => item.status === "running")) stopElapsedTimer();
    wakeSlotWaiters();
    return { successImages, successCount, failCount, canceledCount, error, durationMs };
}

async function runGenerationSlot(jobId: string, index: number, snapshot: ImageGenerationSnapshot, slotRunner: SlotRunner = requestImageSlot, expectedUserId = runtimeOwnerUserId) {
    const currentResult = jobs.find((job) => job.id === jobId)?.results[index];
    if (!currentResult || currentResult.status !== "pending") throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const { signal } = controller;
    controllers.set(currentResult.id, controller);
    const ownerVersion = hydrationVersion;
    const isCurrent = () => runtimeOwnerUserId === expectedUserId && hydrationVersion === ownerVersion;
    try {
        await acquireSlot(currentResult.id, signal, isCurrent);
        signal.throwIfAborted();
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
        const existingServerJobId = currentResult?.serverJobId;
        const idempotencyKey = currentResult?.idempotencyKey || nanoid();
        if (!currentResult?.idempotencyKey) updateResult(jobId, index, { idempotencyKey });
        updateResult(jobId, index, { startedAt: currentResult.startedAt || Date.now() });
        await persistCurrentJob();
        signal.throwIfAborted();
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
        let serverJobId = existingServerJobId;
        let archivedImage: GeneratedImage | undefined;
        const onServerJobArchived = (archivedJob: ServerJob) => {
            const serverImage = archivedJob.result?.images[0];
            if (!serverImage) return;
            void generatedImageFromServerImage(serverImage, archivedJob.id, archivedJob.result?.durationMs).then((image) => {
                archivedImage = image;
                if (!isCurrent()) return;
                const current = jobs.find((job) => job.id === jobId)?.results[index];
                if (current?.serverJobId === archivedJob.id && current.status === "success") updateResult(jobId, index, { image });
            });
        };
        const onCreated = (createdJobId: string) => {
            if (!isCurrent()) return;
            serverJobId = createdJobId;
            updateResult(jobId, index, { serverJobId: createdJobId });
            if (jobs.find((job) => job.id === jobId)?.results[index]?.cancelRequested) void cancelSlot(jobId, index).catch(() => undefined);
        };
        if (existingServerJobId) onCreated(existingServerJobId);
        const request = existingServerJobId
            ? restoreServerImage(existingServerJobId, expectedUserId, onServerJobArchived, signal)
            : currentResult.retryOfServerJobId && PUBLIC_MODE
              ? retryServerImage(currentResult.retryOfServerJobId, idempotencyKey, expectedUserId, onCreated, onServerJobArchived, signal)
              : slotRunner(snapshot, index, onCreated, expectedUserId, idempotencyKey, onServerJobArchived, signal);
        const nextImage = await abortableResult(Promise.resolve(request), signal);
        signal.throwIfAborted();
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
        const persistedImage = archivedImage || (serverJobId ? { ...nextImage, serverJobId } : nextImage);
        updateResult(jobId, index, { status: "success", image: persistedImage, cancelRequested: false, cancelError: undefined });
        return persistedImage;
    } catch (error) {
        if (isCurrent())
            updateResult(jobId, index, { status: signal.aborted || (error instanceof DOMException && error.name === "AbortError") ? "canceled" : "failed", error: signal.aborted ? undefined : friendlyErrorMessage(error), cancelRequested: false });
        throw error;
    } finally {
        if (controllers.get(currentResult.id) === controller) {
            controllers.delete(currentResult.id);
            activeSlots.delete(currentResult.id);
            wakeSlotWaiters();
        }
    }
}

async function requestImageSlot(snapshot: ImageGenerationSnapshot, _index?: number, onServerJobCreated?: (jobId: string) => void, expectedUserId?: string, idempotencyKey?: string, onServerJobArchived?: (job: ServerJob) => void, signal?: AbortSignal) {
    const itemStartedAt = Date.now();
    const options = { signal, cancelOnAbort: false, onJobCreated: onServerJobCreated, onJobArchived: onServerJobArchived, source: { route: "/image", label: "生图工作台" }, expectedUserId, idempotencyKey };
    const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, undefined, options) : await requestGeneration(snapshot.config, snapshot.text, options);
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
        persisted: image.persisted,
        expiresAt: image.expiresAt,
    };
}

function updateResult(jobId: string, index: number, next: Partial<GenerationResult>) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    updateJob(jobId, { results: job.results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item)) });
}

function updateJob(jobId: string, next: Partial<ImageGenerationJob>) {
    jobs = jobs.map((job) => (job.id === jobId ? { ...job, ...next } : job));
    if (next.status && next.status !== "running") trimCompletedJobs();
    emit();
    persistCurrentJob();
}

function trimCompletedJobs() {
    const recent = new Set(
        jobs
            .filter((job) => job.status !== "running")
            .slice(-RECENT_COMPLETED_JOB_LIMIT)
            .map((job) => job.id),
    );
    jobs = jobs.filter((job) => job.status === "running" || job.id === selectedJobId || recent.has(job.id));
}

function startElapsedTimer() {
    if (elapsedTimer) return;
    elapsedTimer = setInterval(() => {
        jobs = jobs.map((job) => (job.status === "running" ? { ...job, elapsedMs: Date.now() - job.startedAt } : job));
        emit();
    }, 1000);
}

function wakeSlotWaiters() {
    [...slotWaiters].forEach((wake) => wake());
}

function acquireSlot(id: string, signal: AbortSignal, isCurrent: () => boolean) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            slotWaiters.delete(check);
            signal.removeEventListener("abort", check);
        };
        const check = () => {
            if (signal.aborted || !isCurrent()) {
                cleanup();
                reject(new DOMException("Aborted", "AbortError"));
                return;
            }
            const limit = Math.min(10, ...jobs.filter((job) => job.status === "running").map((job) => job.concurrencyLimit || 10));
            if (activeSlots.size >= limit) return;
            cleanup();
            activeSlots.add(id);
            resolve();
        };
        slotWaiters.add(check);
        signal.addEventListener("abort", check, { once: true });
        check();
    });
}

function abortableResult<T>(request: Promise<T>, signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
    });
}

function stopElapsedTimer() {
    if (!elapsedTimer) return;
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
}

function emit() {
    listeners.forEach((listener) => listener());
}

async function restoreServerImage(serverJobId: string, expectedUserId: string, onServerJobArchived?: (job: ServerJob) => void, signal?: AbortSignal) {
    const current = await fetchServerJob(serverJobId, expectedUserId);
    const job = current.job.status === "succeeded" ? current.job : await waitForServerJob(serverJobId, { expectedUserId, signal });
    if (job.result?.recoveryPending) {
        void archiveDeferredServerJob(job, expectedUserId)
            .then((archived) => onServerJobArchived?.(archived))
            .catch(() => undefined);
    }
    const image = job.result?.images[0];
    if (!image) throw new Error(job.error || "任务没有返回图片");
    return generatedImageFromServerImage(image, serverJobId, job.result?.durationMs);
}

export async function generatedImageFromServerImage(image: ServerJobImage, serverJobId: string, fallbackDurationMs = 0): Promise<GeneratedImage> {
    const dataUrl = image.persisted === false ? image.recoveryUrl || image.dataUrl : image.dataUrl;
    const meta = await resolveGeneratedImageMeta({ ...image, dataUrl });
    return {
        id: image.id,
        serverJobId,
        dataUrl,
        durationMs: image.durationMs || fallbackDurationMs,
        width: meta.width,
        height: meta.height,
        bytes: image.bytes || getDataUrlByteSize(image.dataUrl),
        mimeType: image.mimeType,
        persisted: image.persisted,
        expiresAt: image.expiresAt,
    };
}

async function retryServerImage(serverJobId: string, idempotencyKey: string, expectedUserId: string, onServerJobCreated: (jobId: string) => void, onServerJobArchived?: (job: ServerJob) => void, signal?: AbortSignal) {
    const { job } = await retryServerJob(serverJobId, expectedUserId, idempotencyKey);
    onServerJobCreated(job.id);
    return restoreServerImage(job.id, expectedUserId, onServerJobArchived, signal);
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
    const initialSelectionVersion = selectionVersion;
    hydrationPromise = loadPersistedImageGenerationJobs(runtimeStore, ownerUserId)
        .then((saved) => {
            if (version !== hydrationVersion || ownerUserId !== runtimeOwnerUserId || !saved) return;
            const restored = saved.jobs.filter((job) => !jobs.some((item) => item.id === job.id));
            jobs = [...restored, ...jobs];
            if (initialSelectionVersion === selectionVersion) selectedJobId = saved.selectedJobId;
            trimCompletedJobs();
            emit();
            for (const job of restored) {
                if (job.status !== "running" || !job.snapshot) continue;
                startElapsedTimer();
                void runGeneration(job.id, job.snapshot, undefined, requestImageSlot, ownerUserId, version, job.slotConcurrency || job.results.length);
            }
        })
        .catch(() => undefined);
}

async function persistCurrentJob() {
    if (typeof window === "undefined" || !runtimeOwnerUserId) return;
    const ownerUserId = runtimeOwnerUserId;
    const version = hydrationVersion;
    await hydrationPromise;
    if (ownerUserId !== runtimeOwnerUserId || version !== hydrationVersion) return;
    const persisted = {
        selectedJobId,
        jobs: jobs.map(
            (job): ImageGenerationJob => ({
                ...job,
                references: job.references.map(stripReferenceData),
                snapshot: job.snapshot
                    ? {
                          ...job.snapshot,
                          references: job.snapshot.references.map(stripReferenceData),
                          config: {
                              ...job.snapshot.config,
                              apiKey: "",
                              channels: job.snapshot.config.channels?.map((channel) => ({ ...channel, apiKey: "" })) || [],
                          },
                      }
                    : undefined,
            }),
        ),
    };
    const operation = runtimePersistence.then(() => runtimeStore.setItem(`${RUNTIME_JOBS_KEY_PREFIX}${encodeURIComponent(ownerUserId)}`, persisted).then(() => undefined));
    runtimePersistence = operation.catch(() => undefined);
    return runtimePersistence;
}

type ImageGenerationRuntimeStorage = {
    getItem: <T>(key: string) => Promise<T | null>;
    setItem: <T>(key: string, value: T) => Promise<T>;
    removeItem: (key: string) => Promise<void>;
};

export async function loadPersistedImageGenerationJobs(storage: ImageGenerationRuntimeStorage, ownerUserId: string, publicMode = PUBLIC_MODE) {
    const key = `${RUNTIME_JOBS_KEY_PREFIX}${encodeURIComponent(ownerUserId)}`;
    const saved = await storage.getItem<{ selectedJobId: string | null; jobs: ImageGenerationJob[] }>(key);
    if (saved) return saved;
    const legacy = await loadPersistedImageGenerationJob(storage, ownerUserId, publicMode);
    if (!legacy) return null;
    const migrated = { selectedJobId: legacy.id, jobs: [legacy] };
    await storage.setItem(key, migrated);
    return migrated;
}

export async function loadPersistedImageGenerationJob(storage: ImageGenerationRuntimeStorage, ownerUserId: string, publicMode = PUBLIC_MODE) {
    const currentKey = publicMode ? `${RUNTIME_JOB_KEY_PREFIX}${encodeURIComponent(ownerUserId)}` : RUNTIME_JOB_KEY;
    let saved = await storage.getItem<ImageGenerationJob>(currentKey);
    if (saved || !publicMode) return saved;

    const legacy = await storage.getItem<ImageGenerationJob>(RUNTIME_JOB_KEY);
    if (!legacy) return null;
    await storage.setItem(currentKey, legacy);
    await storage.removeItem(RUNTIME_JOB_KEY);
    saved = legacy;
    return saved;
}

function stripReferenceData(reference: ReferenceImage): ReferenceImage {
    return reference.storageKey ? { ...reference, dataUrl: "" } : reference;
}

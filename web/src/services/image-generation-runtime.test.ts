import assert from "node:assert/strict";
import { test } from "node:test";

import {
    cancelImageGeneration,
    clearImageGenerationJob,
    getImageGenerationJobsSnapshot,
    generatedImageFromServerImage,
    getImageGenerationSnapshot,
    loadPersistedImageGenerationJob,
    loadPersistedImageGenerationJobs,
    replaceImageGenerationResult,
    selectImageGenerationJob,
    startImageGeneration,
    subscribeImageGeneration,
    type GeneratedImage,
    type ImageGenerationCompletion,
    type ImageGenerationJob,
    type ImageGenerationSnapshot,
} from "./image-generation-runtime";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const testImage: GeneratedImage = { id: "test", dataUrl: "data:image/png;base64,AA==", durationMs: 10, width: 1, height: 1, bytes: 1 };
const testSnapshot: ImageGenerationSnapshot = { text: "test", config: {} as ImageGenerationSnapshot["config"], references: [] };

test("bounds completed task retention without evicting a running task", async () => {
    const activeComplete = deferred<ImageGenerationCompletion>();
    const runningId = startImageGeneration(testSnapshot, 1, activeComplete.resolve, async () => new Promise<GeneratedImage>(() => undefined))!;
    for (let index = 0; index < 24; index++) {
        const complete = deferred<ImageGenerationCompletion>();
        startImageGeneration(testSnapshot, 1, complete.resolve, async () => ({ ...testImage, id: `retained-${index}` }));
        await complete.promise;
    }
    assert.equal(getImageGenerationJobsSnapshot().filter((job) => job.status !== "running").length, 20);
    assert.equal(getImageGenerationJobsSnapshot().find((job) => job.id === runningId)?.status, "running");
    await cancelImageGeneration(runningId);
    await activeComplete.promise;
    for (const job of getImageGenerationJobsSnapshot()) {
        selectImageGenerationJob(job.id);
        clearImageGenerationJob();
    }
});

test("cancels one task without canceling another or accepting a late image", async () => {
    const firstStarted = deferred<void>();
    const lateResult = deferred<GeneratedImage>();
    const firstComplete = deferred<ImageGenerationCompletion>();
    const secondResult = deferred<GeneratedImage>();
    const secondComplete = deferred<ImageGenerationCompletion>();
    const snapshot = { ...testSnapshot, text: "original prompt", references: [{ id: "ref", name: "original", dataUrl: "original" }] };
    let captured!: ImageGenerationSnapshot;
    let firstSignal: AbortSignal | undefined;
    const first = startImageGeneration(snapshot, 1, firstComplete.resolve, async (input, _i, _created, _owner, _key, _archived, signal) => {
        captured = input;
        firstSignal = signal;
        firstStarted.resolve();
        return lateResult.promise;
    })!;
    snapshot.text = "edited prompt";
    snapshot.references[0].dataUrl = "edited";
    const second = startImageGeneration(testSnapshot, 1, secondComplete.resolve, async () => secondResult.promise)!;
    await firstStarted.promise;
    assert.equal(captured.text, "original prompt");
    assert.equal(captured.references[0].dataUrl, "original");
    await cancelImageGeneration(first);
    const canceled = await firstComplete.promise;
    assert.equal(firstSignal?.aborted, true);
    assert.equal(canceled.canceledCount, 1);
    assert.equal(canceled.failCount, 0);
    assert.equal(getImageGenerationSnapshot()?.id, second);
    assert.equal(getImageGenerationSnapshot()?.status, "running");
    lateResult.resolve({ ...testImage, id: "late" });
    secondResult.resolve({ ...testImage, id: "second" });
    await secondComplete.promise;
    assert.equal(getImageGenerationJobsSnapshot().find((job) => job.id === first)?.results[0].status, "canceled");
    assert.equal(getImageGenerationSnapshot()?.results[0].image?.id, "second");
    selectImageGenerationJob(first);
    assert.equal(clearImageGenerationJob(), true);
    selectImageGenerationJob(second);
    assert.equal(clearImageGenerationJob(), true);
});

test("shares the concurrency budget between batches and cancels queued work before submission", async () => {
    const active = deferred<void>();
    const released = deferred<GeneratedImage>();
    const firstComplete = deferred<ImageGenerationCompletion>();
    const queuedComplete = deferred<ImageGenerationCompletion>();
    const nextStarted = deferred<void>();
    const nextComplete = deferred<ImageGenerationCompletion>();
    let queuedCalls = 0;
    const first = startImageGeneration(
        testSnapshot,
        1,
        firstComplete.resolve,
        async () => {
            active.resolve();
            return released.promise;
        },
        1,
        1,
    )!;
    await active.promise;
    const queued = startImageGeneration(
        testSnapshot,
        1,
        queuedComplete.resolve,
        async () => {
            queuedCalls++;
            return testImage;
        },
        1,
        1,
    )!;
    assert.equal(getImageGenerationSnapshot()?.results[0].startedAt, undefined);
    await cancelImageGeneration(queued);
    assert.equal((await queuedComplete.promise).canceledCount, 1);
    const next = startImageGeneration(
        testSnapshot,
        1,
        nextComplete.resolve,
        async () => {
            nextStarted.resolve();
            return testImage;
        },
        1,
        1,
    )!;
    assert.equal(getImageGenerationSnapshot()?.results[0].startedAt, undefined);
    released.resolve(testImage);
    await firstComplete.promise;
    await nextStarted.promise;
    await nextComplete.promise;
    assert.equal(queuedCalls, 0);
    for (const id of [first, queued, next]) {
        selectImageGenerationJob(id);
        clearImageGenerationJob();
    }
});

test("canceling a whole batch skips slots that have not started", async () => {
    const started = deferred<void>();
    const complete = deferred<ImageGenerationCompletion>();
    let calls = 0;
    const id = startImageGeneration(
        testSnapshot,
        4,
        complete.resolve,
        async () => {
            calls++;
            started.resolve();
            return new Promise<GeneratedImage>(() => undefined);
        },
        1,
    )!;
    await started.promise;
    await cancelImageGeneration(id);
    const outcome = await complete.promise;
    assert.equal(calls, 1);
    assert.equal(outcome.canceledCount, 4);
    assert.equal(outcome.failCount, 0);
    assert.equal(clearImageGenerationJob(), true);
});

test("restores all saved tasks and the selected task without leaking another account", async () => {
    const values = new Map<string, unknown>();
    const storage = {
        async getItem<T>(key: string) {
            return (values.get(key) as T | undefined) ?? null;
        },
        async setItem<T>(key: string, value: T) {
            values.set(key, value);
            return value;
        },
        async removeItem(key: string) {
            values.delete(key);
        },
    };
    const saved = { selectedJobId: "second", jobs: [{ id: "first" }, { id: "second" }] };
    values.set("image-jobs:v3:user-a", saved);
    assert.deepEqual(await loadPersistedImageGenerationJobs(storage, "user-a", true), saved);
    assert.equal(await loadPersistedImageGenerationJobs(storage, "user-b", true), null);
});

test("accepts a second image task while the first task is still generating", async () => {
    clearImageGenerationJob();
    const snapshot = { text: "first task", config: {} as ImageGenerationSnapshot["config"], references: [] };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const completions: Promise<ImageGenerationCompletion>[] = [];
    const submit = (text: string) => {
        let complete!: (value: ImageGenerationCompletion) => void;
        completions.push(
            new Promise((resolve) => {
                complete = resolve;
            }),
        );
        const id = startImageGeneration({ ...snapshot, text }, 1, complete, async () => {
            await gate;
            return { id: text, dataUrl: "data:image/png;base64,AA==", durationMs: 10, width: 1, height: 1, bytes: 1 };
        });
        if (!id) complete({ successImages: [], successCount: 0, failCount: 1, durationMs: 0 });
        return id;
    };
    try {
        const first = submit("first task");
        const second = submit("second task");
        assert.ok(first);
        assert.ok(second, "a running task must not lock the next submission");
        assert.notEqual(first, second);
    } finally {
        release();
        await Promise.all(completions);
        clearImageGenerationJob();
    }
});

test("temporary images display through the available relay and saved images use the permanent asset", async () => {
    const source = { id: "25", dataUrl: "https://img.uuapi.net/result.png", recoveryUrl: "https://relay.test/signed", width: 1254, height: 1254, bytes: 0, durationMs: 99000, mimeType: "image/png", persisted: false };
    const temporary = await generatedImageFromServerImage(source, "job-25");
    assert.equal(temporary.dataUrl, source.recoveryUrl);
    assert.equal(temporary.width, 1254);
    assert.equal(temporary.persisted, false);
    const saved = await generatedImageFromServerImage({ ...source, persisted: true, dataUrl: "/api/job-files/25/result.png" }, "job-25");
    assert.equal(saved.dataUrl, "/api/job-files/25/result.png");
});

test("migrates the legacy active image task into the authenticated account key", async () => {
    const values = new Map<string, unknown>();
    const legacy: ImageGenerationJob = {
        id: "legacy-job",
        prompt: "legacy",
        references: [],
        status: "succeeded",
        results: [],
        startedAt: 1,
        elapsedMs: 1,
        successCount: 0,
        failCount: 0,
    };
    values.set("active-image-job:v1", legacy);
    const storage = {
        async getItem<T>(key: string) {
            return (values.get(key) as T | undefined) ?? null;
        },
        async setItem<T>(key: string, value: T) {
            values.set(key, value);
            return value;
        },
        async removeItem(key: string) {
            values.delete(key);
        },
    };

    const restored = await loadPersistedImageGenerationJob(storage, "user-a", true);

    assert.equal(restored?.id, "legacy-job");
    assert.equal(values.has("active-image-job:v1"), false);
    assert.equal((values.get("active-image-job:v2:user-a") as { id: string })?.id, "legacy-job");
});

test("preserves temporary persistence metadata from a completed server job", async () => {
    const image = await generatedImageFromServerImage(
        {
            id: "temporary-image",
            dataUrl: "https://img.uuapi.net/result.png",
            durationMs: 42_000,
            width: 1024,
            height: 1024,
            bytes: 0,
            mimeType: "image/png",
            persisted: false,
            expiresAt: "2026-08-13T00:00:00.000Z",
        },
        "job-a",
    );

    assert.equal(image.serverJobId, "job-a");
    assert.equal(image.persisted, false);
    assert.equal(image.expiresAt, "2026-08-13T00:00:00.000Z");
    assert.equal(image.dataUrl, "https://img.uuapi.net/result.png");
});

test("replaces a temporary workbench result after browser archiving completes", async () => {
    clearImageGenerationJob();
    const snapshot = { text: "browser archive", config: {} as ImageGenerationSnapshot["config"], references: [] };
    const completed = new Promise<ImageGenerationCompletion>((resolve) => {
        startImageGeneration(snapshot, 1, resolve, async (_snapshot, _index, onJobCreated, _expectedUserId, _idempotencyKey, onJobArchived) => {
            onJobCreated?.("job-archive");
            queueMicrotask(() => {
                onJobArchived?.({
                    id: "job-archive",
                    status: "succeeded",
                    createdAt: Date.now(),
                    prompt: "browser archive",
                    model: "gpt-image-2",
                    count: 1,
                    result: {
                        images: [
                            {
                                id: "image-archive",
                                dataUrl: "/api/job-files/job-archive/result.png",
                                durationMs: 42_000,
                                width: 1024,
                                height: 1024,
                                bytes: 2048,
                                mimeType: "image/png",
                                persisted: true,
                            },
                        ],
                        successCount: 1,
                        failCount: 0,
                        durationMs: 42_000,
                        recoveryPending: false,
                    },
                });
            });
            return {
                id: "image-archive",
                serverJobId: "job-archive",
                dataUrl: "https://img.uuapi.net/uu-image-temp/result.png",
                durationMs: 42_000,
                width: 1024,
                height: 1024,
                bytes: 0,
                mimeType: "image/png",
                persisted: false,
            };
        });
    });

    await completed;
    await Bun.sleep(1);
    const image = getImageGenerationSnapshot()?.results[0]?.image;
    assert.equal(image?.dataUrl, "/api/job-files/job-archive/result.png");
    assert.equal(image?.persisted, true);
    assert.equal(image?.bytes, 2048);
    assert.equal(clearImageGenerationJob(), true);
});

test("keeps an image task running while the workbench page is unsubscribed", async () => {
    clearImageGenerationJob();
    let resolveSlot: (image: GeneratedImage) => void = () => undefined;
    const slot = new Promise<GeneratedImage>((resolve) => {
        resolveSlot = resolve;
    });
    let resolveCompletion: () => void = () => undefined;
    const completed = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
    });
    let notifications = 0;
    const unsubscribe = subscribeImageGeneration(() => {
        notifications += 1;
    });
    const snapshot = { text: "persistent task", config: {} as ImageGenerationSnapshot["config"], references: [] };
    const jobId = startImageGeneration(snapshot, 1, resolveCompletion, async () => slot);

    assert.ok(jobId);
    assert.equal(getImageGenerationSnapshot()?.status, "running");
    assert.equal(getImageGenerationSnapshot()?.results[0]?.status, "pending");
    assert.equal(clearImageGenerationJob(), false);
    unsubscribe();

    resolveSlot({ id: "image-1", dataUrl: "data:image/png;base64,AA==", durationMs: 10, width: 1, height: 1, bytes: 1 });
    await completed;

    const restored = getImageGenerationSnapshot();
    assert.equal(restored?.id, jobId);
    assert.equal(restored?.status, "succeeded");
    assert.equal(restored?.results[0]?.status, "success");
    assert.ok(notifications >= 1);
    assert.equal(clearImageGenerationJob(), true);
});

test("replaces a displayed result with the persisted output format", async () => {
    clearImageGenerationJob();
    let resolveCompletion: () => void = () => undefined;
    const completed = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
    });
    const snapshot = { text: "format conversion", config: {} as ImageGenerationSnapshot["config"], references: [] };
    startImageGeneration(snapshot, 1, resolveCompletion, async () => ({ id: "image-format", dataUrl: "/api/job-files/job/image.png", durationMs: 10, width: 1, height: 1, bytes: 1, mimeType: "image/png" }));

    await completed;
    replaceImageGenerationResult({ id: "image-format", dataUrl: "/api/assets/image.jpg", storageKey: "image:jpeg", durationMs: 10, width: 1, height: 1, bytes: 2, mimeType: "image/jpeg" });

    const image = getImageGenerationSnapshot()?.results[0]?.image;
    assert.equal(image?.dataUrl, "/api/assets/image.jpg");
    assert.equal(image?.mimeType, "image/jpeg");
    assert.equal(clearImageGenerationJob(), true);
});

test("limits parallel image slots without dropping failures or later work", async () => {
    clearImageGenerationJob();
    const snapshot = { text: "bounded generation", config: {} as ImageGenerationSnapshot["config"], references: [] };
    const base: GeneratedImage = { id: "base", dataUrl: "data:image/png;base64,AA==", durationMs: 10, width: 1, height: 1, bytes: 1 };
    let active = 0;
    let maximum = 0;
    const completed = new Promise<ImageGenerationCompletion>((resolve) => {
        startImageGeneration(
            snapshot,
            4,
            resolve,
            async (_snapshot, index) => {
                active += 1;
                maximum = Math.max(maximum, active);
                await Bun.sleep(5);
                active -= 1;
                if (index === 1) throw new Error("slot failed");
                return { ...base, id: `slot-${index}` };
            },
            2,
        );
    });

    const result = await completed;
    assert.equal(maximum, 2);
    assert.equal(result.successCount, 3);
    assert.equal(result.failCount, 1);
    assert.deepEqual(
        getImageGenerationSnapshot()?.results.map((item) => item.status),
        ["success", "failed", "success", "success"],
    );
    assert.equal(clearImageGenerationJob(), true);
});

test("assigns a stable idempotency key before a generation slot starts", async () => {
    clearImageGenerationJob();
    const snapshot = { text: "idempotent generation", config: {} as ImageGenerationSnapshot["config"], references: [] };
    let receivedKey = "";
    const completed = new Promise<ImageGenerationCompletion>((resolve) => {
        startImageGeneration(snapshot, 1, resolve, async (_snapshot, _index, _onJobCreated, _expectedUserId, idempotencyKey) => {
            receivedKey = idempotencyKey || "";
            return { id: "stable-key", dataUrl: "data:image/png;base64,AA==", durationMs: 10, width: 1, height: 1, bytes: 1 };
        });
    });

    await completed;
    assert.match(receivedKey, /^[A-Za-z0-9_-]{8,128}$/);
    assert.equal(getImageGenerationSnapshot()?.results[0]?.idempotencyKey, receivedKey);
    assert.equal(clearImageGenerationJob(), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clearImageGenerationJob,
    getImageGenerationSnapshot,
    replaceImageGenerationResult,
    startImageGeneration,
    subscribeImageGeneration,
    type GeneratedImage,
    type ImageGenerationCompletion,
    type ImageGenerationSnapshot,
} from "./image-generation-runtime";

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
    assert.deepEqual(getImageGenerationSnapshot()?.results.map((item) => item.status), ["success", "failed", "success", "success"]);
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

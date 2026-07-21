import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clearImageGenerationJob,
    getImageGenerationSnapshot,
    startImageGeneration,
    subscribeImageGeneration,
    type GeneratedImage,
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

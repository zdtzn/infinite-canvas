import assert from "node:assert/strict";
import localforage from "localforage";

Object.defineProperty(globalThis, "window", { configurable: true, value: { __RUNTIME_CONFIG__: { PUBLIC_MODE: false }, setTimeout, clearTimeout } });
const blob = new Blob(["local-image"], { type: "image/png" });
const expiredUrl = URL.createObjectURL(blob);
URL.revokeObjectURL(expiredUrl);
const reference = { id: "reference", name: "reference", storageKey: "image:reference", thumbnailKey: "image:reference-thumb", dataUrl: "", thumbnailUrl: expiredUrl };
const saved = {
    selectedJobId: "finished",
    jobs: [{
        id: "finished", prompt: "test", status: "succeeded", references: [reference],
        snapshot: { text: "test", config: {}, references: [reference] },
        results: [{ id: "slot", status: "success", image: { id: "result", storageKey: "image:result", thumbnailKey: "image:result-thumb", dataUrl: expiredUrl, thumbnailUrl: expiredUrl, width: 1, height: 1, bytes: blob.size, durationMs: 1 } }],
        startedAt: 1, elapsedMs: 1, successCount: 1, failCount: 0,
    }],
};
localforage.createInstance = ((options: { storeName?: string }) => ({
    async getItem(key: string) { return options.storeName === "generation_runtime" ? (key === "image-jobs:v3:local" ? structuredClone(saved) : null) : key.startsWith("image:") ? blob : null; },
    async setItem(_key: string, value: unknown) { return value; },
    async removeItem() {},
})) as unknown as typeof localforage.createInstance;
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(String(input).startsWith("blob:"), "reload must not submit generation or contact a service");
    return nativeFetch(input, init);
}) as typeof fetch;
const runtime = await import("../image-generation-runtime");
runtime.getImageGenerationSnapshot();
const deadline = Date.now() + 2000;
while (!runtime.getImageGenerationSnapshot()) {
    assert.ok(Date.now() < deadline, "hydration did not settle");
    await Bun.sleep(1);
}
const restored = runtime.getImageGenerationSnapshot()!;
for (const image of [restored.results[0].image!, restored.references[0], restored.snapshot!.references[0]]) {
    assert.notEqual(image.dataUrl, expiredUrl);
    assert.notEqual(image.thumbnailUrl, expiredUrl);
    assert.equal(await (await fetch(image.dataUrl)).text(), "local-image");
    assert.equal(await (await fetch(image.thumbnailUrl!)).text(), "local-image");
}
assert.equal(restored.status, "succeeded");
console.log("local result reload passed");

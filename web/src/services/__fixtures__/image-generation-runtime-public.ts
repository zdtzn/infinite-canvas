// Runs in a separate process so PUBLIC_MODE and browser storage cannot leak into other tests.
import assert from "node:assert/strict";
import localforage from "localforage";
import type { GeneratedImage, ImageGenerationCompletion, ImageGenerationSnapshot } from "../image-generation-runtime";

Object.defineProperty(globalThis, "window", { value: { __RUNTIME_CONFIG__: { PUBLIC_MODE: true }, setTimeout, clearTimeout }, configurable: true });
const stored = new Map<string, unknown>();
localforage.createInstance = (() => ({
    async getItem(key: string) {
        return structuredClone(stored.get(key) ?? null);
    },
    async setItem(key: string, value: unknown) {
        stored.set(key, structuredClone(value));
        return value;
    },
    async removeItem(key: string) {
        stored.delete(key);
    },
})) as unknown as typeof localforage.createInstance;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
async function until(predicate: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, "condition did not settle");
        await Bun.sleep(1);
    }
}

const runtime = await import("../image-generation-runtime");
const { useUserStore } = await import("@/stores/use-user-store");
const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "" });
useUserStore.getState().setSession(user("public-a"));
runtime.prepareImageGenerationRuntimeForUser("public-a");
const image: GeneratedImage = { id: "image", dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, durationMs: 1 };
const snapshot: ImageGenerationSnapshot = { text: "test", references: [], config: { apiKey: "test-only-secret", channels: [{ apiKey: "test-only-secret" }] } as ImageGenerationSnapshot["config"] };
const deletes: string[] = [];
let failCancel = false;
let cancelStatus = "canceled";
let retryResponse = deferred<Response>();
let retryCalls = 0;
let submissionMode: "delay" | "lost-response" | "complete" = "delay";
const submissionResponse = deferred<Response>();
const submissionKeys: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get("X-Expected-User-Id"), "public-a");
    if (init?.method === "DELETE") {
        deletes.push(url);
        if (failCancel) return Response.json({ error: "cancel unavailable" }, { status: 503 });
        return Response.json({ job: { id: url.split("/").pop(), status: cancelStatus } });
    }
    if (init?.method === "POST" && url.endsWith("/retry")) {
        retryCalls++;
        return retryResponse.promise;
    }
    if (init?.method === "POST" && url === "/api/jobs/images") {
        submissionKeys.push(new Headers(init.headers).get("Idempotency-Key") || "");
        if (submissionMode === "lost-response") throw new Error("submission response lost after server acceptance");
        if (submissionMode === "delay") return submissionResponse.promise;
        return Response.json({ job: { id: "api-created", status: "running" } });
    }
    if (url === "/api/jobs/api-created" && submissionMode === "complete") return Response.json({ job: { id: "api-created", status: "succeeded", result: { images: [image], successCount: 1, failCount: 0, durationMs: 1 } } });
    if (url.startsWith("/api/jobs/")) return Response.json({ job: { id: url.split("/").pop(), status: "running" } });
    throw new Error(`Unexpected request: ${url}`);
}) as typeof fetch;

function start(id: string, announce = true) {
    const started = deferred<void>();
    const result = deferred<GeneratedImage>();
    const completed = deferred<ImageGenerationCompletion>();
    let onCreated: ((id: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    const jobId = runtime.startImageGeneration(snapshot, 1, completed.resolve, async (_snapshot, _index, created, _owner, _key, _archived, requestSignal) => {
        onCreated = created;
        signal = requestSignal;
        if (announce) created?.(id);
        started.resolve();
        return result.promise;
    })!;
    return { jobId, started, result, completed, announce: () => onCreated?.(id), signal: () => signal };
}

try {
    const early = start("late-id", false);
    await early.started.promise;
    await runtime.cancelImageGeneration(early.jobId);
    assert.equal(runtime.getImageGenerationSnapshot()?.results[0].cancelRequested, true);
    assert.equal(deletes.length, 0);
    early.announce();
    assert.equal((await early.completed.promise).canceledCount, 1);
    assert.equal(early.signal()?.aborted, true);
    assert.deepEqual(deletes, ["/api/jobs/late-id"]);
    early.result.resolve(image);
    await Bun.sleep(1);
    assert.equal(runtime.getImageGenerationSnapshot()?.status, "canceled");

    // Restoring the account resumes all pending slots, including a persisted cancellation request.
    const resumeA = start("resume-a");
    await resumeA.started.promise;
    const resumeB = start("resume-b");
    await resumeB.started.promise;
    await until(() => JSON.stringify(stored.get("image-jobs:v3:public-a")).includes("resume-b"));
    runtime.prepareImageGenerationRuntimeForUser("");
    runtime.prepareImageGenerationRuntimeForUser("public-a");
    await until(() => runtime.getImageGenerationJobsSnapshot().some((job) => job.id === resumeB.jobId));
    resumeA.result.resolve(image);
    resumeB.result.resolve(image);
    await runtime.cancelImageGeneration(resumeA.jobId);
    await runtime.cancelImageGeneration(resumeB.jobId);
    await until(() =>
        runtime
            .getImageGenerationJobsSnapshot()
            .filter((job) => job.id === resumeA.jobId || job.id === resumeB.jobId)
            .every((job) => job.status === "canceled"),
    );
    assert.ok(deletes.includes("/api/jobs/resume-a"));
    assert.ok(deletes.includes("/api/jobs/resume-b"));

    const failure = start("failed-cancel");
    await failure.started.promise;
    failCancel = true;
    await assert.rejects(runtime.cancelImageGeneration(failure.jobId));
    assert.equal(runtime.getImageGenerationSnapshot()?.status, "running");
    assert.equal(runtime.getImageGenerationSnapshot()?.results[0].cancelRequested, false);
    assert.match(runtime.getImageGenerationSnapshot()?.results[0].cancelError || "", /取消失败/);
    assert.equal(failure.signal()?.aborted, false);
    failCancel = false;
    await runtime.cancelImageGeneration(failure.jobId);
    await failure.completed.promise;

    const race = start("already-finished");
    await race.started.promise;
    cancelStatus = "succeeded";
    await runtime.cancelImageGeneration(race.jobId);
    assert.equal(race.signal()?.aborted, false);
    race.result.resolve(image);
    assert.equal((await race.completed.promise).successCount, 1);
    cancelStatus = "canceled";

    // Cancel a retry while its new ID is still in flight: never cancel only the old ID.
    runtime.selectImageGenerationJob(early.jobId);
    const retry = runtime.retryImageGeneration(0, snapshot);
    await until(() => retryCalls === 1);
    await runtime.cancelImageGeneration(early.jobId);
    assert.equal(runtime.getImageGenerationSnapshot()?.results[0].cancelRequested, true);
    retryResponse.resolve(Response.json({ job: { id: "new-retry-id", status: "running" } }));
    assert.equal(await retry, null);
    assert.equal(deletes.at(-1), "/api/jobs/new-retry-id");
    assert.equal(runtime.getImageGenerationSnapshot()?.status, "canceled");

    await until(() => Boolean(stored.get("image-jobs:v3:public-a")));
    const serialized = JSON.stringify(stored.get("image-jobs:v3:public-a"));
    assert.ok(!serialized.includes("test-only-secret"), "runtime persistence must strip API keys");
    assert.ok(serialized.includes("new-retry-id"));

    // Exercise the actual runtime -> image API -> server API path, entirely intercepted.
    const { defaultConfig } = await import("@/stores/use-config-store");
    const managedSnapshot: ImageGenerationSnapshot = {
        text: "managed pipeline",
        references: [],
        config: {
            ...defaultConfig,
            count: "1",
            model: "qa::gpt-image-2.5",
            imageModel: "qa::gpt-image-2.5",
            channels: [{ id: "qa", name: "QA", baseUrl: "https://fixture.invalid/v1", apiKey: "", credentialState: "saved", apiFormat: "openai", models: [{ name: "gpt-image-2.5", capability: "image" }] }],
        },
    };
    const apiComplete = deferred<ImageGenerationCompletion>();
    const apiId = runtime.startImageGeneration(managedSnapshot, 1, apiComplete.resolve)!;
    await until(() => submissionKeys.length === 1);
    await runtime.cancelImageGeneration(apiId);
    submissionResponse.resolve(Response.json({ job: { id: "api-created", status: "running" } }));
    assert.equal((await apiComplete.promise).canceledCount, 1);
    assert.equal(deletes.filter((url) => url === "/api/jobs/api-created").length, 1, "only the runtime should send DELETE");

    submissionMode = "lost-response";
    const lostComplete = deferred<ImageGenerationCompletion>();
    runtime.startImageGeneration(managedSnapshot, 1, lostComplete.resolve);
    assert.equal((await lostComplete.promise).failCount, 1);
    const lostKey = submissionKeys.at(-1);
    submissionMode = "complete";
    const recovered = await runtime.retryImageGeneration(0, managedSnapshot);
    assert.equal(recovered?.serverJobId, "api-created");
    assert.equal(submissionKeys.at(-1), lostKey, "unknown submission outcome must replay its key, not create another paid job");

    const old = start("old-owner", false);
    await old.started.promise;
    useUserStore.getState().setSession(user("public-b"));
    runtime.prepareImageGenerationRuntimeForUser("public-b");
    old.announce();
    old.result.resolve(image);
    await Bun.sleep(5);
    assert.equal(runtime.getImageGenerationJobsSnapshot().length, 0);
    assert.ok(!deletes.includes("/api/jobs/old-owner"));
    console.log("public runtime: early cancellation, cancellation failure/retry, completion race, retry submission race, actual API pipeline, idempotent recovery, secret stripping and owner isolation passed");
} finally {
    runtime.prepareImageGenerationRuntimeForUser("");
}

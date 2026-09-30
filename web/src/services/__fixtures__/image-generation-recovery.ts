import assert from "node:assert/strict";
import localforage from "localforage";
import type { GeneratedImage, ImageGenerationJob } from "../image-generation-runtime";

const stored = new Map<string, unknown>();
localforage.createInstance = (() => ({
    async getItem(key: string) { return structuredClone(stored.get(key) ?? null); },
    async setItem(key: string, value: unknown) { stored.set(key, structuredClone(value)); return value; },
    async removeItem(key: string) { stored.delete(key); },
})) as unknown as typeof localforage.createInstance;
Object.defineProperty(globalThis, "window", { configurable: true, value: {
    __RUNTIME_CONFIG__: { PUBLIC_MODE: true },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, [1200, 1800, 3000].includes(ms) ? 1 : ms), clearTimeout,
} });
const { useUserStore } = await import("@/stores/use-user-store");
const runtime = await import("../image-generation-runtime");
const session = (id: string) => {
    useUserStore.getState().setSession({ id, username: id, displayName: id, avatarUrl: "" });
    runtime.prepareImageGenerationRuntimeForUser(id);
};
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
};
async function until(predicate: () => boolean) {
    const deadline = Date.now() + 1500;
    while (!predicate()) { assert.ok(Date.now() < deadline, "condition did not settle"); await Bun.sleep(1); }
}
const image = (id: string): GeneratedImage => ({ id, serverJobId: id, dataUrl: `https://fixture.invalid/${id}`, persisted: false, width: 1, height: 1, bytes: 1, durationMs: 1 });
const completed = (id: string): ImageGenerationJob => ({ id, prompt: "test", references: [], status: "succeeded", startedAt: 1, elapsedMs: 1, successCount: 1, failCount: 0,
    results: [{ id: `slot-${id}`, status: "success", serverJobId: id, image: image(id) }] });
const serverJob = (id: string, persisted = true) => ({ id, status: "succeeded", result: { images: [{ ...image(id), persisted, dataUrl: `/api/job-files/${id}/image.png`, recoveryUrl: `https://fixture.invalid/${id}` }], recoveryPending: !persisted } });
const scenario = process.argv[2];
try {
    if (scenario === "archive") {
        stored.set("image-jobs:v3:owner", { selectedJobId: "0", jobs: Array.from({ length: 5 }, (_, i) => completed(String(i))) });
        const gate = deferred<void>();
        let active = 0, peak = 0, reads = 0, archives = 0, relays = 0;
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            if (url.startsWith("https://fixture.invalid/")) { relays++; return new Response(new Blob(["image"], { type: "image/png" })); }
            assert.equal(new Headers(init?.headers).get("X-Expected-User-Id"), "owner");
            if (url.endsWith("/archive")) { archives++; assert.equal(init?.method, "POST"); return Response.json({ job: serverJob(url.split("/")[3]) }); }
            assert.equal(init?.method || "GET", "GET", "recovery must never submit paid work");
            reads++; active++; peak = Math.max(peak, active);
            await gate.promise; active--;
            const id = url.split("/").pop()!;
            return Response.json({ job: serverJob(id, id !== "0") });
        }) as typeof fetch;
        session("owner");
        await until(() => runtime.getImageGenerationJobsSnapshot().length === 5);
        await Bun.sleep(10);
        assert.ok(reads > 0, "completed temporary results must resume reconciliation");
        assert.ok(peak <= 2, "archive recovery concurrency must stay bounded");
        gate.resolve();
        await until(() => runtime.getImageGenerationJobsSnapshot().every((job) => job.results[0].image?.persisted === true));
        await until(() => (stored.get("image-jobs:v3:owner") as { jobs: ImageGenerationJob[] }).jobs.every((job) => job.results[0].image?.persisted === true));
        assert.equal(reads, 5); assert.equal(relays, 1); assert.equal(archives, 1);
        assert.ok(runtime.getImageGenerationSnapshot()?.results[0].image?.dataUrl.startsWith("/api/job-files/"));
        console.log("archive recovery passed");
    } else if (scenario === "archive-failure") {
        stored.set("image-jobs:v3:owner", { selectedJobId: "one", jobs: [completed("one")] });
        let fail = true, reads = 0;
        globalThis.fetch = (async (_url, init) => {
            assert.equal(init?.method || "GET", "GET"); reads++;
            return fail ? Response.json({ error: "offline" }, { status: 503 }) : Response.json({ job: serverJob("one") });
        }) as typeof fetch;
        session("owner");
        await until(() => Boolean(runtime.getImageGenerationSnapshot()?.results[0].image?.archiveError));
        assert.equal(runtime.getImageGenerationSnapshot()?.status, "succeeded");
        fail = false;
        const pending = runtime.getImageGenerationSnapshot()!.results[0].image!;
        await Promise.all([runtime.retryImageGenerationArchive(pending), runtime.retryImageGenerationArchive(pending)]);
        assert.equal(reads, 2, "manual retries should coalesce");
        assert.equal(runtime.getImageGenerationSnapshot()?.results[0].image?.persisted, true);
        assert.equal(runtime.getImageGenerationSnapshot()?.results[0].image?.archiveError, undefined);
        console.log("archive failure and retry passed");
    } else if (scenario === "archive-session") {
        stored.set("image-jobs:v3:owner", { selectedJobId: "one", jobs: [completed("one")] });
        const oldResponse = deferred<Response>();
        let reads = 0;
        globalThis.fetch = (async (_url, init) => {
            assert.equal(init?.method || "GET", "GET");
            assert.equal(new Headers(init?.headers).get("X-Expected-User-Id"), "owner");
            return ++reads === 1 ? oldResponse.promise : Response.json({ job: serverJob("one") });
        }) as typeof fetch;
        session("owner"); await until(() => reads === 1);
        session("other"); await Bun.sleep(2);
        assert.equal(runtime.getImageGenerationJobsSnapshot().length, 0);
        assert.equal(await runtime.retryImageGenerationArchive(image("one"), "owner"), null);
        session("owner");
        await until(() => runtime.getImageGenerationSnapshot()?.results[0].image?.persisted === true);
        const oldJob = serverJob("one"); oldJob.result.images[0].dataUrl = "/api/job-files/stale/image.png";
        oldResponse.resolve(Response.json({ job: oldJob })); await Bun.sleep(5);
        assert.equal(reads, 2);
        assert.equal(runtime.getImageGenerationSnapshot()?.results[0].image?.dataUrl, "/api/job-files/one/image.png");
        console.log("archive session isolation passed");
    } else if (scenario === "cancel") {
        const oldDelete = deferred<Response>(), currentDelete = deferred<Response>();
        let deletes = 0, reads = 0;
        globalThis.fetch = (async (_url, init) => {
            assert.equal(new Headers(init?.headers).get("X-Expected-User-Id"), "owner");
            if (init?.method === "DELETE") {
                deletes++;
                return deletes === 1 ? oldDelete.promise : deletes === 2 ? currentDelete.promise : Response.json({ job: { id: "server", status: "canceled" } });
            }
            assert.equal(init?.method || "GET", "GET"); reads++;
            return Response.json({ job: { id: "server", status: "running" } });
        }) as typeof fetch;
        session("owner");
        let started = false;
        const jobId = runtime.startImageGeneration({ text: "test", references: [], config: {} as never }, 1, undefined, async (_s, _i, created) => {
            created?.("server"); started = true; return new Promise(() => undefined);
        })!;
        await until(() => started);
        const oldCancel = runtime.cancelImageGeneration(jobId).catch(() => undefined);
        await until(() => (stored.get("image-jobs:v3:owner") as { jobs: ImageGenerationJob[] })?.jobs[0].results[0].cancelRequested === true);
        session("other"); await Bun.sleep(2); session("owner");
        await until(() => reads > 0);
        oldDelete.resolve(Response.json({ error: "old failed" }, { status: 503 })); await oldCancel; await Bun.sleep(10);
        assert.equal(deletes, 2, "new session must replay cancellation instead of sharing the old promise");
        const joined = runtime.cancelImageGeneration(jobId).catch(() => undefined);
        assert.equal(deletes, 2, "old cleanup must not remove the current cancellation");
        currentDelete.resolve(Response.json({ error: "current failed" }, { status: 503 })); await joined;
        assert.equal(runtime.getImageGenerationSnapshot()?.results[0].cancelRequested, false);
        assert.ok(runtime.getImageGenerationSnapshot()?.results[0].cancelError);
        await runtime.cancelImageGeneration(jobId);
        await until(() => runtime.getImageGenerationSnapshot()?.status === "canceled");
        assert.equal(deletes, 3);
        console.log("cancel session isolation passed");
    } else {
        throw new Error(`Unknown scenario: ${scenario}`);
    }
} finally {
    runtime.prepareImageGenerationRuntimeForUser("");
}

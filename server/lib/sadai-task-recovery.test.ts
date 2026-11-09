import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { hasSadaiAsyncTask, SadaiTaskHttpError } from "./sadai-async";
import { hasUuAsyncTask, UuAsyncCapabilityRegistry } from "./uu-image-async";
import { resolveOpenAiImageSize } from "./image-request";
import { sadaiImageBaseUrl } from "./sadai-image";
import { dragonImageBaseUrl, dragonPromptWithSize } from "./dragon-image";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
function extract(start: string, end: string, after = 0) {
    const from = source.indexOf(start, after);
    const until = source.indexOf(end, from + start.length);
    if (from < 0 || until < 0) throw new Error(`Missing production block: ${start}`);
    return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(from, until));
}
function harness({ submitError, pollError }: { submitError?: Error; pollError?: Error } = {}) {
    const input = { userId: "fixture-member", channelId: "fixture-channel", model: "gpt-image-2.6-flare", apiFormat: "openai", prompt: "fixture", count: 1,
        references: ["data:image/png;base64,AAAA"], size: "1:1", quality: "low" } as any;
    const job = { id: "fixture-job", input, status: "running" };
    const calls: string[] = [];
    const snapshots: any[] = [];
    const asyncRegistry = new UuAsyncCapabilityRegistry();
    const urlRegistry = new UuAsyncCapabilityRegistry();
    const context = {
        hasSadaiAsyncTask, SadaiTaskHttpError, sadaiImageBaseUrl, dragonImageBaseUrl, dragonPromptWithSize, resolveOpenAiImageSize,
        sadaiAsyncCapability: asyncRegistry, sadaiUrl26Capability: urlRegistry,
        upstreamIdempotencyKey: (id: string) => `fixture:${id}`,
        submitSadaiAsyncTask: async () => { calls.push("submit"); if (submitError) throw submitError; return "accepted-task"; },
        waitForSadaiAsyncTask: async (...args: any[]) => {
            calls.push(`poll:${args[2]}`);
            if (pollError) throw pollError;
            await args[7]?.onStatus?.("succeeded");
            return { urls: ["https://images.example.com/result.png"], status: "SUCCESS" };
        },
        materializeImageInput: async (value: any) => { calls.push("materialize"); return value; },
        imageQueue: { touch: async () => { calls.push("persist"); snapshots.push(JSON.parse(JSON.stringify(input))); } },
        generateOpenAiImages: async () => { calls.push("sync"); return ["https://images.example.com/sync.png"]; },
        console: { info: () => {} },
    };
    const generate = vm.runInNewContext(`${extract("async function generateSadaiAsyncImages(", "async function generateOpenAiImages(")}\ngenerateSadaiAsyncImages;`, context);
    return { input, calls, snapshots, asyncRegistry, urlRegistry,
        run: () => generate({ baseUrl: "https://api.sadai.top/v1" }, "fixture-key", input, job, new AbortController().signal, job.id) };
}

test("persists accepted SADAI tasks before polling and preserves reference images", async () => {
    const h = harness();
    await h.run();
    expect(h.calls).toEqual(["materialize", "submit", "persist", "poll:accepted-task", "persist"]);
    expect(h.snapshots[0].upstream).toEqual({ provider: "sadai-image", taskId: "accepted-task", status: "pending" });
    expect(h.snapshots[0].references).toEqual(["data:image/png;base64,AAAA"]);
    expect(h.snapshots.at(-1).upstream.status).toBe("succeeded");
});

test("polling 404 never falls back to a second paid generation", async () => {
    const error = new SadaiTaskHttpError(404, "poll", "SADAI 查询失败（HTTP 404）");
    const h = harness({ pollError: error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.calls).not.toContain("sync");
    expect(h.input.upstream.taskId).toBe("accepted-task");
});

test("only submission endpoint 404 falls back and leaves URL capability enabled", async () => {
    const h = harness({ submitError: new SadaiTaskHttpError(404, "submit", "Not Found") });
    expect(await h.run()).toEqual(["https://images.example.com/sync.png"]);
    expect(h.asyncRegistry.canSubmit("sadai:fixture-channel:gpt-image-2.6-flare")).toBe(false);
    expect(h.urlRegistry.canSubmit("sadai:fixture-channel:gpt-image-2.6-flare")).toBe(true);
    expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
});

test("submission timeout is never replayed or downgraded automatically", async () => {
    const error = new DOMException("submission outcome unknown", "TimeoutError");
    const h = harness({ submitError: error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.calls).toEqual(["materialize", "submit"]);
});

test("resuming a known SADAI task only queries and never materializes or submits again", async () => {
    const h = harness();
    h.input.upstream = { provider: "sadai-image", taskId: "previous-task", status: "pending" };
    expect(await h.run()).toEqual(["https://images.example.com/result.png"]);
    expect(h.calls).toEqual(["poll:previous-task", "persist"]);
});

test("server restart requeues accepted SADAI tasks without refunding their reservation", () => {
    const input = { userId: "fixture-member", upstream: { provider: "sadai-image", taskId: "accepted-task", status: "running" } };
    const job = { id: "fixture-job", input, status: "running", createdAt: 1 };
    let refunds = 0;
    const restored: any[] = [];
    const context = { state: { jobs: { [job.id]: job } }, hasUuAsyncTask, hasSadaiAsyncTask, Date,
        cultivation: { refundGeneration: () => { refunds++; } }, cleanupJobOutputFilesFor: () => {},
        imageQueue: { restore: (value: unknown) => { restored.push(value); } }, scheduleJobImageRecovery: () => {} };
    vm.runInNewContext(extract("for (const job of Object.values(state.jobs)) {", "cultivation?.reconcileReservations(", source.indexOf("const imageQueue =")), context);
    expect(restored[0].status).toBe("queued");
    expect(restored[0].input.upstream.taskId).toBe("accepted-task");
    expect(refunds).toBe(0);
});

test("retry keeps a pending SADAI task but clears confirmed failed tasks", () => {
    const copy = vm.runInNewContext(`${extract("function copyImageJobInputForRetry(", "function copyStoredImageReferenceForRetry(")}\ncopyImageJobInputForRetry;`);
    const input = { userId: "fixture-member", references: [], upstream: { provider: "sadai-image", taskId: "same-task", status: "pending" } };
    expect(copy(input, "retry-job", "source-job").upstream).toEqual(input.upstream);
    expect(copy({ ...input, upstream: { ...input.upstream, status: "failed" } }, "retry-job", "source-job").upstream).toBeUndefined();
});

test("retrying a failed recovery joins an already active retry of the original task", async () => {
    const failed = { id: "failed-recovery", status: "failed", input: { userId: "member", retryOf: "original" } };
    const active = { id: "active-recovery", status: "running", input: { userId: "member", retryOf: "original" } };
    const retry = vm.runInNewContext(`${extract("async function retryJob(", "function assertUnusedImageJobId(")}\nretryJob;`, {
        ownedJob: () => failed, requiredIdempotencyKey: () => "fresh-key", createHash,
        state: { jobs: {} }, assertUnusedImageJobId: () => {}, imageQueue: { list: () => [failed, active] },
        publicJob: (job: unknown) => job, json: (body: unknown, status: number) => ({ body, status }),
    });
    expect(await retry({}, { userId: "member" }, failed.id)).toEqual({ body: { job: active }, status: 200 });
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { IMAGE_SUBMISSION_UNCONFIRMED, isImageSubmissionUnconfirmed } from "../../shared/image-submission";
import { hasSadaiAsyncTask, SadaiTaskHttpError } from "./sadai-async";
import { hasUuAsyncTask, isUuAsyncTasksDisabledError, readUuAsyncTask, UuAsyncCapabilityRegistry } from "./uu-image-async";
import { resolveOpenAiImageSize } from "./image-request";
import { buildSadaiImageRequestOptions, sadaiImageBaseUrl } from "./sadai-image";
import { dragonImageBaseUrl, dragonPromptWithSize } from "./dragon-image";
import { createDeferredImageResult } from "./image-result-recovery";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
function extract(start: string, end: string, after = 0) {
    const from = source.indexOf(start, after);
    const until = source.indexOf(end, from + start.length);
    if (from < 0 || until < 0) throw new Error(`Missing production block: ${start}`);
    return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(from, until));
}
const submission = extract("async function recordImageSubmission(", "async function generateSadaiAsyncImages(");
const retryHelpers = extract("function reusableImageTask(", "function copyImageJobInputForRetry(");
class HttpError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
function harness({ submitError, pollError, previews }: { submitError?: Error; pollError?: Error; previews?: any[] } = {}) {
    const input = { userId: "fixture-member", channelId: "fixture-channel", model: "gpt-image-2.6-flare", apiFormat: "openai", prompt: "fixture", count: 1,
        references: ["data:image/png;base64,AAAA"], size: "1:1", quality: "low" } as any;
    const job = { id: "fixture-job", input, status: "running", startedAt: Date.now() - 1000 };
    const calls: string[] = [];
    const bodies: any[] = [];
    const submitOptions: any[] = [];
    const snapshots: any[] = [];
    const asyncRegistry = new UuAsyncCapabilityRegistry();
    const urlRegistry = new UuAsyncCapabilityRegistry();
    const context = {
        hasSadaiAsyncTask, SadaiTaskHttpError, sadaiImageBaseUrl, buildSadaiImageRequestOptions, createHash, createDeferredImageResult, dragonImageBaseUrl, dragonPromptWithSize, resolveOpenAiImageSize, IMAGE_SUBMISSION_UNCONFIRMED, REQUEST_TIMEOUT_MS: 600_000,
        sadaiAsyncCapability: asyncRegistry, sadaiUrl26Capability: urlRegistry,
        upstreamIdempotencyKey: (id: string) => `fixture:${id}`,
        submitSadaiAsyncTask: async (_base: string, _key: string, body: unknown, _signal: unknown, _fetch: unknown, options: unknown) => { bodies.push(body); submitOptions.push(options); calls.push("submit"); if (submitError) throw submitError; return "accepted-task"; },
        waitForSadaiAsyncTask: async (...args: any[]) => {
            calls.push(`poll:${args[2]}`);
            if (pollError) throw pollError;
            if (previews) {
                await args[7]?.onStatus?.("running");
                await args[7]?.onImages?.(previews);
                await args[7]?.onImages?.(previews);
            }
            await args[7]?.onStatus?.("succeeded");
            return { urls: ["https://images.example.com/result.png"], status: "SUCCESS" };
        },
        materializeImageInput: async (value: any) => { calls.push("materialize"); return value; },
        imageQueue: { touch: async () => { calls.push("persist"); snapshots.push(JSON.parse(JSON.stringify(input))); } },
        generateOpenAiImages: async () => { calls.push("sync"); return ["https://images.example.com/sync.png"]; },
        console: { info: () => {} },
    };
    const generate = vm.runInNewContext(`${submission}\n${extract("async function generateSadaiAsyncImages(", "async function generateOpenAiImages(")}\ngenerateSadaiAsyncImages;`, context);
    return { input, calls, bodies, submitOptions, snapshots, job, asyncRegistry, urlRegistry,
        run: () => generate({ baseUrl: "https://api.sadai.top/v1" }, "fixture-key", input, job, new AbortController().signal, job.id) };
}

test("persists accepted SADAI tasks before polling and preserves reference images", async () => {
    const h = harness();
    await h.run();
    expect(h.calls).toEqual(["materialize", "persist", "submit", "persist", "poll:accepted-task", "persist"]);
    expect(h.snapshots[0]).toMatchObject({ submissionUnconfirmed: true, references: ["data:image/png;base64,AAAA"] });
    expect(h.snapshots[1].submissionUnconfirmed).toBeUndefined();
    expect(h.snapshots[1].upstream).toEqual({ provider: "sadai-image", taskId: "accepted-task", status: "pending" });
    expect(h.submitOptions[0].requestTimeoutMs).toBe(600_000);
    expect(h.snapshots.at(-1).upstream.status).toBe("succeeded");
});

test("submits documented SADAI dimensions instead of an ignored OpenAI size parameter", async () => {
    const h = harness();
    h.input.imageQuality = "low";
    await h.run();
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]).toMatchObject({ model: "gpt-image-2.6-flare", n: 1, aspect_ratio: "1:1", resolution: "1k", quality: "low", response_format: "url", images: ["data:image/png;base64,AAAA"] });
    expect(h.bodies[0]).not.toHaveProperty("size");
});

test("persists preview metadata once without completing or resubmitting the accepted task", async () => {
    const h = harness({ previews: [{ id: "provider-image", url: "https://images.example.com/result.png", width: 1254, height: 1254, bytes: 100, mimeType: "image/png" }] });
    await h.run();
    const previews = h.snapshots.filter(snapshot => snapshot.upstream?.status === "running" && snapshot.upstream.previewImages?.length);
    expect(previews).toHaveLength(1);
    expect(previews[0].upstream.previewImages[0]).toMatchObject({ dataUrl: "https://images.example.com/result.png", width: 1254, height: 1254, bytes: 100, persisted: false });
    expect(h.job.status).toBe("running");
    expect(h.calls.filter(call => call === "submit")).toHaveLength(1);
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
    await expect(h.run()).rejects.toThrow("提交结果未确认");
    expect(h.calls).toEqual(["materialize", "persist", "submit"]);
    expect(h.input.submissionUnconfirmed).toBe(true);
});

test.each(["headers", "body", "gateway"])("UU reference upload keeps an unconfirmed submission after a %s timeout", async (stage) => {
    const timeouts: number[] = [];
    const stages: string[] = [];
    const input = { channelId: "uu", model: "gpt-image-2.6", references: ["fixture"], count: 1, submissionUnconfirmed: undefined };
    const registry = new UuAsyncCapabilityRegistry();
    const context = {
        hasUuAsyncTask, uuAsyncCapabilityRegistry: registry, uuAsyncCapabilityKey: (id: string) => id,
        materializeImageInput: async (value: unknown) => value, dataUrlBlob: () => new Blob(),
        buildUuAsyncImageSubmission: () => ({ path: "/images/edits/async", body: new FormData() }),
        buildUpstreamUrl: (_base: string, _format: string, path: string) => path,
        upstreamIdempotencyKey: (id: string) => id, REQUEST_TIMEOUT_MS: 600_000, UU_ASYNC_REQUEST_TIMEOUT_MS: 30_000,
        IMAGE_SUBMISSION_UNCONFIRMED, readUuAsyncTask, isUuAsyncTasksDisabledError,
        imageQueue: { touch: async () => { stages.push("persist"); } },
        upstreamFetch: async (_url: string, _init: unknown, _retry: boolean, timeout: number) => {
            timeouts.push(timeout);
            stages.push("submit");
            if (stage === "headers") throw new HttpError(504, "超时");
            return Response.json({}, { status: stage === "gateway" ? 504 : 200 });
        },
        parseUpstreamJson: async () => {
            stages.push("body");
            if (stage === "gateway") throw new Error("上游服务返回 504");
            throw new DOMException("The operation timed out.", "TimeoutError");
        },
    };
    const generate = vm.runInNewContext(`${submission}\n${extract("async function generateUuAsyncImages(", "async function pollUuImageTask(")}\ngenerateUuAsyncImages;`, context);
    await expect(generate({ baseUrl: "https://uuapi.cc/v1" }, "key", input, { id: "job", input }, new AbortController().signal, "job")).rejects.toThrow("提交结果未确认");
    expect(timeouts).toEqual([600_000]);
    expect(stages).toEqual(stage === "headers" ? ["persist", "submit"] : ["persist", "submit", "body"]);
    expect(input.submissionUnconfirmed).toBe(true);
});

test("resuming a known SADAI task only queries and never materializes or submits again", async () => {
    const h = harness();
    h.input.upstream = { provider: "sadai-image", taskId: "previous-task", status: "pending" };
    expect(await h.run()).toEqual(["https://images.example.com/result.png"]);
    expect(h.calls).toEqual(["poll:previous-task", "persist"]);
});

test("restart resumes a known task and refunds an interrupted submission whose ID was never confirmed", () => {
    const input = { userId: "fixture-member", upstream: { provider: "sadai-image", taskId: "accepted-task", status: "running" } };
    const job = { id: "fixture-job", input, status: "running", createdAt: 1 };
    const interrupted = { id: "interrupted", input: { userId: "fixture-member", submissionUnconfirmed: true }, status: "running", createdAt: 2 };
    const refunds: string[] = [];
    const restored: any[] = [];
    const context = { state: { jobs: { [job.id]: job, [interrupted.id]: interrupted } }, hasUuAsyncTask, hasSadaiAsyncTask, Date, IMAGE_SUBMISSION_UNCONFIRMED,
        cultivation: { refundGeneration: (id: string) => { refunds.push(id); } }, cleanupJobOutputFilesFor: () => {},
        imageQueue: { restore: (value: unknown) => { restored.push(value); } }, scheduleJobImageRecovery: () => {} };
    vm.runInNewContext(extract("for (const job of Object.values(state.jobs)) {", "cultivation?.reconcileReservations(", source.indexOf("const imageQueue =")), context);
    expect(restored[0].status).toBe("queued");
    expect(restored[0].input.upstream.taskId).toBe("accepted-task");
    expect(restored[1]).toMatchObject({ status: "failed", error: IMAGE_SUBMISSION_UNCONFIRMED });
    expect(refunds).toEqual(["interrupted"]);
});

test("retry keeps a pending SADAI task but clears confirmed failed tasks", () => {
    const copy = vm.runInNewContext(`${retryHelpers}\n${extract("function copyImageJobInputForRetry(", "function copyStoredImageReferenceForRetry(")}\ncopyImageJobInputForRetry;`);
    const input = { userId: "fixture-member", references: [], upstream: { provider: "sadai-image", taskId: "same-task", status: "pending" } };
    expect(copy(input, "retry-job", "source-job").upstream).toEqual(input.upstream);
    expect(copy({ ...input, upstream: { ...input.upstream, status: "unknown" } }, "retry-job", "source-job").upstream?.taskId).toBe("same-task");
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

test.each(["提交结果未确认", "The operation timed out."])("uncertain submissions cannot be retried through the API: %s", async (error) => {
    const failed = { id: "failed", status: "failed", error, input: { userId: "member" } };
    const retry = vm.runInNewContext(`${retryHelpers}\n${extract("async function retryJob(", "function assertUnusedImageJobId(")}\nretryJob;`, {
        ownedJob: () => failed, requiredIdempotencyKey: () => "fresh-key", createHash, HttpError,
        state: { jobs: {} }, assertUnusedImageJobId: () => {}, imageQueue: { list: () => [failed] },
        IMAGE_SUBMISSION_UNCONFIRMED, isImageSubmissionUnconfirmed,
    });
    await expect(retry({}, { userId: "member" }, failed.id)).rejects.toMatchObject({ status: 409, message: IMAGE_SUBMISSION_UNCONFIRMED });
});

test.each([0, 1])("recovering a UU result reserves only when the original task settled %i images", async (successCount) => {
    const failed = { id: "original", status: "failed", input: { userId: "member", references: [], count: 1, upstream: { provider: "uu-image", taskId: "same-task", status: "succeeded" } } };
    let reservations = 0;
    const retry = vm.runInNewContext(`${retryHelpers}\n${extract("function copyImageJobInputForRetry(", "function copyStoredImageReferenceForRetry(")}\n${extract("async function retryJob(", "function assertUnusedImageJobId(")}\nretryJob;`, {
        ownedJob: () => failed, requiredIdempotencyKey: () => "fresh-key", createHash,
        state: { jobs: {} }, assertUnusedImageJobId: () => {}, assertDiskCapacity: () => {},
        imageQueue: { list: () => [failed], add: (input: unknown) => input },
        imageJobReferenceTotalBytes: () => 0, MAX_IMAGE_REFERENCE_TOTAL_BYTES: 100,
        cultivation: { getGenerationUsage: () => ({ successCount }), reserveGeneration: () => { reservations++; } }, activeUserJobs: () => 0,
        publicJob: (job: unknown) => job, json: (body: unknown, status: number) => ({ body, status }),
    });
    const result = await retry({}, { userId: "member" }, failed.id);
    expect(result.status).toBe(202);
    expect(result.body.job.upstream.taskId).toBe("same-task");
    expect(result.body.job.recoveryOnly).toBe(successCount > 0 ? true : undefined);
    expect(reservations).toBe(successCount > 0 ? 0 : 1);
});

test("a UU cancellation HTTP error keeps the local job running until cancellation is accepted", async () => {
    const job = { id: "running", status: "running", input: { upstream: { provider: "uu-image", taskId: "upstream", status: "pending" } } };
    const warnings: unknown[] = [];
    let upstreamStatus = 503;
    const context = {
        HttpError, hasUuAsyncTask, uuImageCancellations: new Map(), ownedJob: () => job,
        imageQueue: { cancel: () => { job.status = "canceled"; return true; } }, cultivation: undefined,
        buildUpstreamUrl: () => "https://uuapi.cc/v1/images/tasks/upstream", buildUuAsyncTaskPath: () => "/images/tasks/upstream",
        platformChannel: () => ({ baseUrl: "https://uuapi.cc/v1" }), decryptChannelApiKey: () => "fixture-key",
        upstreamFetch: async () => new Response(null, { status: upstreamStatus }), UU_ASYNC_REQUEST_TIMEOUT_MS: 30_000,
        console: { warn: (warning: unknown) => warnings.push(warning) },
        publicJob: (value: unknown) => value, json: (body: unknown) => body,
    };
    const cancel = vm.runInNewContext(`${extract("async function deleteJob(", "function publicJob(")}\n${extract("async function cancelUuImageJob(", "function waitForAbortableDelay(")}\ndeleteJob;`, context);
    await expect(cancel(new URL("http://fixture.test"), {}, job.id)).rejects.toMatchObject({ status: 502 });
    expect(job.status).toBe("running");
    expect(warnings).toHaveLength(1);
    upstreamStatus = 204;
    await cancel(new URL("http://fixture.test"), {}, job.id);
    expect(job.status).toBe("canceled");
    expect(job.input.upstream.status).toBe("canceled");
});

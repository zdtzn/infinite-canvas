import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildOpenAiImageRequestOptions, imageResponseItemValue, imageResponseItems, resolveOpenAiImageSize, usesJsonReferenceGeneration } from "./image-request";
import { dragonImageBaseUrl, dragonPromptWithSize, isDragonChatImageModel, isDragonGptImageModel } from "./dragon-image";
import { buildSadaiImageRequestOptions, isSadaiImage25Channel, isSadaiImage2Channel, sadaiImageBaseUrl } from "./sadai-image";
import { isUuImage25Channel } from "./uu-image-async";
import { assertAllowedUpstreamUrl, buildUpstreamUrl } from "./url-policy";
import { createDeferredImageResult, hasDeferredImageResults, isRecoverableImageDownloadError, recoverDeferredImageResults } from "./image-result-recovery";
import { resolvePlatformChannel } from "./platform-channels";
import { isRelayEligibleResultUrl } from "./result-image-relay";
import { readUpstreamErrorMessage, readUpstreamNonJsonError } from "./upstream-error";
import { KeyedSerialExecutor } from "./keyed-serial-executor";

// Execute the production request and reader functions without starting the server,
// reading its database/environment, or making any external request.
const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const extract = (start: string, end: string) => {
    const offset = source.indexOf(start);
    if (offset < 0) throw new Error(`Missing production function: ${start}`);
    const next = source.indexOf(end, offset + start.length);
    if (next < 0) throw new Error(`Missing next production function: ${end}`);
    return source.slice(offset, next);
};
const executable = new Bun.Transpiler({ loader: "ts" }).transformSync([
    extract("async function generateOpenAiImages(", "async function generateUuAsyncImages("),
    extract("async function parseUpstreamJson(", "async function proxyPromptAsset("),
    extract("async function readResponseBytes(", "function clientIp("),
    extract("function upstreamIdempotencyKey(", "function enforceSameOrigin("),
    extract("function imageOutputFormatMimeType(", "function normalizeJobSource("),
].join("\n"));

class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

function harness(upstream: (setTime: (time: number) => void) => Promise<Response>, limit = 48 * 1024 * 1024) {
    let time = 1_000;
    const logs: Array<Record<string, unknown>> = [];
    const requests: Array<{ url: string; init: RequestInit; retryable: boolean }> = [];
    const setTime = (next: number) => { time = next; };
    const input = { channelId: "fixture-channel", model: "gpt-image-2.5-flare", prompt: "do-not-log-prompt", count: 1, quality: "low", size: "9:16", references: [] };
    const channel = { baseUrl: "https://verysadai.com/v1" };
    const context = {
        Date: { now: () => time }, TextDecoder, Uint8Array, FormData, createHash, HttpError,
        console: { info: (line: string) => logs.push(JSON.parse(line)) },
        MAX_UPSTREAM_JSON_BYTES: 2 * 1024 * 1024,
        MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES: limit,
        buildOpenAiImageRequestOptions, imageResponseItemValue, imageResponseItems, resolveOpenAiImageSize, usesJsonReferenceGeneration,
        dragonImageBaseUrl, dragonPromptWithSize, isDragonChatImageModel, isDragonGptImageModel,
        buildSadaiImageRequestOptions, isSadaiImage25Channel, isSadaiImage2Channel, sadaiImageBaseUrl, isUuImage25Channel, buildUpstreamUrl,
        readUpstreamErrorMessage, readUpstreamNonJsonError,
        upstreamFetch: async (url: string, init: RequestInit, retryable: boolean) => {
            requests.push({ url, init, retryable });
            return upstream(setTime);
        },
    };
    const generate = vm.runInNewContext(`${executable}\ngenerateOpenAiImages;`, context);
    const run = (signal = new AbortController().signal) => generate(channel, "do-not-log-api-key", input, signal, "fixture-job");
    const onlyLog = () => {
        expect(requests).toHaveLength(1);
        expect(requests[0].retryable).toBe(false);
        expect(logs).toHaveLength(1);
        expect(Object.keys(logs[0]).sort()).toEqual(["channelId", "event", "jobId", "model", "outcome", "responseBodyMs", "responseBytes", "responseHeadersMs", "responseType", "stage", "status", "totalMs"].sort());
        const serialized = JSON.stringify(logs);
        for (const secret of [input.prompt, "do-not-log-api-key", "do-not-log-error", "do-not-log-body", "https://", "text/event-stream", "text/html"]) expect(serialized).not.toContain(secret);
        return logs[0];
    };
    return { run, onlyLog, requests, input, channel };
}

test("records a headers failure once and preserves the original exception without retrying paid work", async () => {
    const error = new Error("do-not-log-error");
    const h = harness(async (setTime) => { setTime(1_250); throw error; });
    await expect(h.run()).rejects.toBe(error);
    expect(h.onlyLog()).toMatchObject({ event: "image_upstream_timing", stage: "waiting_headers", outcome: "failed", status: null, responseType: "unknown", responseBytes: 0, responseHeadersMs: null, responseBodyMs: null, totalMs: 250 });
});

test("records a response-body failure after headers without replacing its timeout", async () => {
    const error = new DOMException("do-not-log-error", "TimeoutError");
    const h = harness(async (setTime) => {
        setTime(1_100);
        return new Response(new ReadableStream({ pull(controller) { setTime(1_400); controller.error(error); } }, { highWaterMark: 0 }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    });
    await expect(h.run()).rejects.toBe(error);
    expect(h.onlyLog()).toMatchObject({ stage: "reading_body", outcome: "failed", status: 200, responseType: "event-stream", responseBytes: 0, responseHeadersMs: 100, responseBodyMs: 300, totalMs: 400 });
});

test("counts actual streamed bytes before a later read fails and releases the reader", async () => {
    const error = new Error("do-not-log-error");
    const chunk = new TextEncoder().encode('{"data":"do-not-log-body');
    let pulls = 0;
    let body: ReadableStream<Uint8Array>;
    const h = harness(async (setTime) => {
        setTime(1_050);
        body = new ReadableStream({ pull(controller) {
            if (pulls++ === 0) { setTime(1_100); controller.enqueue(chunk); }
            else { setTime(1_500); controller.error(error); }
        } }, { highWaterMark: 0 });
        return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    await expect(h.run()).rejects.toBe(error);
    expect(body!.locked).toBe(false);
    expect(h.onlyLog()).toMatchObject({ stage: "reading_body", outcome: "failed", responseType: "json", responseBytes: chunk.byteLength, responseHeadersMs: 50, responseBodyMs: 450, totalMs: 500 });
});

test("successful SADAI 2.5 generation uses the recommended host and keeps the model and request parameters", async () => {
    const url = "https://image.invalid/do-not-log-body.png";
    const bytes = new TextEncoder().encode(JSON.stringify({ data: [{ url }] }));
    let pulls = 0;
    const h = harness(async (setTime) => {
        setTime(1_070);
        return new Response(new ReadableStream({ pull(controller) {
            if (pulls++ === 0) { setTime(1_130); controller.enqueue(bytes); }
            else { setTime(1_200); controller.close(); }
        } }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    });
    expect(await h.run()).toEqual([url]);
    expect(h.onlyLog()).toMatchObject({ stage: "completed", outcome: "succeeded", status: 200, responseType: "json", responseBytes: bytes.byteLength, responseHeadersMs: 70, responseBodyMs: 130, totalMs: 200 });
    expect(h.requests[0].url).toBe("https://api.sadai.top/v1/images/generations");
    const { input } = h;
    expect(JSON.parse(String(h.requests[0].init.body))).toEqual({
        model: input.model,
        prompt: input.prompt,
        ...buildOpenAiImageRequestOptions({ count: input.count, size: resolveOpenAiImageSize(input.size, input.quality, input.model, "https://verysadai.com/v1"), responseFormat: "url" }),
    });
    expect(h.requests[0].init.method).toBe("POST");
    expect((h.requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer do-not-log-api-key");
});

test("SADAI 2.5 accepts inline image data from the same URL request without a second paid request", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const h = harness(async () => Response.json({ data: [{ b64_json: png }] }));
    expect(await h.run()).toEqual([`data:image/png;base64,${png}`]);
    expect(JSON.parse(String(h.requests[0].init.body)).response_format).toBe("url");
    h.onlyLog();
});

test("legacy SADAI Image2 and custom or unrelated channels keep their Base64 request format", async () => {
    for (const [baseUrl, model] of [
        ["https://api.sadai.top/v1", "gpt-image-2"],
        ["https://proxy.example.com/v1", "gpt-image-2.5-flare"],
        ["https://verysadai.com/custom/v1", "gpt-image-2.5-flare"],
        ["https://api.sadai.top/custom/v1", "gpt-image-2.5-sunburst"],
    ]) {
        const h = harness(async () => Response.json({ data: [{ url: "https://image.invalid/result.png" }] }));
        h.channel.baseUrl = baseUrl;
        h.input.model = model;
        await h.run();
        expect(JSON.parse(String(h.requests[0].init.body)).response_format).toBe("b64_json");
        h.onlyLog();
    }
});

const jobExecutable = new Bun.Transpiler({ loader: "ts" }).transformSync(extract("async function runImageJob(", "async function materializeImageInput("));

function deliveryHarness(raw: string, persist: (raw: string) => Promise<unknown>, baseUrl = "https://api.sadai.top/v1", model = "gpt-image-2.5-flare") {
    const calls = { generate: 0, persist: 0, settle: 0, refund: 0 };
    const input = { apiFormat: "openai", channelId: "fixture-channel", model, prompt: "fixture", count: 1, userId: "fixture-user", references: [] };
    const job = { id: "fixture-job", status: "running", createdAt: 0, startedAt: 10 };
    const context = {
        Date, URL,
        platformChannel: () => ({ baseUrl }), decryptChannelApiKey: () => "fixture-key",
        hasUuAsyncTask: () => false, uuAsyncCapabilityRegistry: { canSubmit: () => false }, uuAsyncCapabilityKey: () => "fixture",
        materializeImageInput: async () => input,
        generateOpenAiImages: async () => { calls.generate++; return [raw]; },
        imageJobPhases: new Map(), isRelayEligibleResultUrl: () => false,
        createDeferredImageResult, hasDeferredImageResults, assertAllowedUpstreamUrl, isRecoverableImageDownloadError, isSadaiImage25Channel,
        randomUUID: () => "fixture-image", RESULT_IMAGE_DOWNLOAD_TIMEOUT_MS: 8_000,
        persistJobImage: async (_user: string, _job: string, value: string) => { calls.persist++; return persist(value); },
        cleanupJobOutputFilesFor: () => {},
        cultivation: { settleGeneration: () => { calls.settle++; }, refundGeneration: () => { calls.refund++; } },
        performanceMetrics: { recordImage: () => {} }, console: { info: () => {} },
        abortError: (signal: AbortSignal) => signal.reason || new Error("canceled"),
    };
    const runJob = vm.runInNewContext(`${jobExecutable}\nrunImageJob;`, context);
    return { calls, run: () => runJob(input, new AbortController().signal, job) };
}

test("SADAI 2.5 returns a validated URL before any image download and generates only once", async () => {
    const url = "https://image.invalid/result.png";
    const h = deliveryHarness(url, async () => { throw new Error("must not download before returning the result"); });
    expect(await h.run()).toMatchObject({ images: [{ dataUrl: url, persisted: false }], recoveryPending: true, successCount: 1 });
    expect(h.calls).toEqual({ generate: 1, persist: 0, settle: 1, refund: 0 });
});

test("SADAI 2.5 inline fallback and other channels retain the existing persistence path", async () => {
    for (const [raw, baseUrl, model] of [
        ["data:image/png;base64,iVBORw0KGgo=", "https://api.sadai.top/v1", "gpt-image-2.5-flare"],
        ["https://image.invalid/result.png", "https://api.sadai.top/v1", "gpt-image-2"],
        ["https://image.invalid/result.png", "https://proxy.example.com/v1", "gpt-image-2.5-flare"],
    ]) {
        const image = { id: "fixture-image", dataUrl: "/api/output/fixture.png", bytes: 8, mimeType: "image/png" };
        const h = deliveryHarness(raw, async () => image, baseUrl, model);
        expect(await h.run()).toMatchObject({ images: [image], successCount: 1 });
        expect(h.calls).toEqual({ generate: 1, persist: 1, settle: 1, refund: 0 });
    }
});

test("SADAI 2.5 rejects private or non-HTTPS results before downloading without retrying generation", async () => {
    for (const [url, message] of [
        ["https://127.0.0.1/private.png", "接口地址不能指向本机或内网"],
        ["http://image.invalid/result.png", "公网模式的接口地址必须使用 HTTPS"],
    ]) {
        const h = deliveryHarness(url, async () => { throw new Error("must validate before downloading"); });
        await expect(h.run()).rejects.toThrow(message);
        expect(h.calls).toEqual({ generate: 1, persist: 0, settle: 0, refund: 1 });
    }
});

const recoveryExecutable = new Bun.Transpiler({ loader: "ts" }).transformSync([
    extract("function recoverJobImages(", "async function performJobImageRecovery("),
    extract("async function performJobImageRecovery(", "function hasServerRecoverableDeferredImages("),
    extract("function hasServerRecoverableDeferredImages(", "function storedImageReferenceBytes("),
].join("\n"));

function recoveryHarness(baseUrl: string | null = "https://api.sadai.top/v1", model = "gpt-image-2.5-flare", options: { relay?: boolean; persist?: () => Promise<unknown> } = {}) {
    const url = options.relay ? "https://img.uuapi.net/uu-image-temp/result.png" : "https://image.invalid/result.png";
    const job = {
        id: "fixture-job", status: "succeeded",
        input: { apiFormat: "openai", userId: "fixture-user", channelId: "fixture-channel", model },
        result: { images: [createDeferredImageResult({ id: "fixture-image", url, durationMs: 42 })], successCount: 1, failCount: 0, durationMs: 42, recoveryPending: true },
    };
    const archived = { id: "server-created-id", dataUrl: "/api/job-files/fixture.png", bytes: 8, durationMs: 42, mimeType: "image/png" };
    const downloads: Array<{ url: string; options: { downloadTimeoutMs: number; downloadAttempts: number } }> = [];
    const calls = { touch: 0, generate: 0, settle: 0, refund: 0 };
    const context = {
        AbortController, Error, assertAllowedUpstreamUrl, hasDeferredImageResults, recoverDeferredImageResults, resolvePlatformChannel, isSadaiImage25Channel, isRelayEligibleResultUrl,
        state: { auth: { adminUserId: "fixture-admin" }, channels: baseUrl ? { "fixture-admin:fixture-channel": { baseUrl } } : {} },
        RESULT_IMAGE_RELAY_CONFIG: options.relay ? {} : undefined, RESULT_IMAGE_RELAY_SERVER_DOWNLOAD: true,
        RESULT_IMAGE_DOWNLOAD_TIMEOUT_MS: 8_000, RESULT_IMAGE_RELAY_DOWNLOAD_TIMEOUT_MS: 30_000,
        imageRecoveryRuns: new Map(), jobImageMutationExecutor: new KeyedSerialExecutor(),
        imageQueue: { get: (id: string) => id === job.id ? job : undefined, touch: async () => { calls.touch++; } },
        persistJobImage: async (_user: string, _job: string, value: string, _duration: number, _signal: AbortSignal, downloadOptions: { downloadTimeoutMs: number; downloadAttempts: number }) => {
            downloads.push({ url: value, options: downloadOptions });
            return options.persist ? options.persist() : archived;
        },
        generateOpenAiImages: () => { calls.generate++; throw new Error("must not regenerate during recovery"); },
        cultivation: { settleGeneration: () => { calls.settle++; }, refundGeneration: () => { calls.refund++; } },
        console: { info: () => {} },
    };
    const recovery = vm.runInNewContext(`${recoveryExecutable}\n({ perform: performJobImageRecovery, recover: recoverJobImages });`, context);
    return { job, archived, url, downloads, calls, run: () => recovery.perform(job.id), recover: () => recovery.recover(job.id) };
}

test("only official SADAI 2.5 background downloads get 180 seconds and still attempt each GET once", async () => {
    for (const [baseUrl, model, relay, timeout] of [
        ["https://api.sadai.top/v1", "gpt-image-2.5-flare", false, 180_000],
        ["https://verysadai.com/v1", "gpt-image-2.5-sunburst", false, 180_000],
        ["https://api.sadai.top/v1", "gpt-image-2", false, 8_000],
        ["https://api.uuapi.com/v1", "gpt-image-2.5-flare", false, 8_000],
        ["https://proxy.example.com/v1", "gpt-image-2.5-flare", false, 8_000],
        ["https://api.sadai.top/custom/v1", "gpt-image-2.5-sunburst", false, 8_000],
        [null, "gpt-image-2.5-flare", false, 8_000],
        ["https://api.sadai.top/v1", "gpt-image-2.5-flare", true, 30_000],
    ] as const) {
        const h = recoveryHarness(baseUrl, model, { relay });
        await h.run();
        expect(h.downloads).toEqual([{ url: h.url, options: { downloadTimeoutMs: timeout, downloadAttempts: 1 } }]);
        expect(h.calls).toEqual({ touch: 1, generate: 0, settle: 0, refund: 0 });
    }
});

test("repeated recovery requests join the unfinished background download without regenerating", async () => {
    const pending = Promise.withResolvers<unknown>();
    const h = recoveryHarness(undefined, undefined, { persist: () => pending.promise });
    const first = h.recover();
    const retried = h.recover();
    expect(retried).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.downloads).toEqual([{ url: h.url, options: { downloadTimeoutMs: 180_000, downloadAttempts: 1 } }]);
    expect(h.job.result.images[0].persisted).toBe(false);
    expect(h.calls.generate).toBe(0);
    pending.resolve(h.archived);
    expect(await first).toEqual({ recovered: 1, remaining: 0 });
    expect(await retried).toEqual({ recovered: 1, remaining: 0 });
    expect(h.downloads).toHaveLength(1);
    expect(h.job.result.images[0]).toMatchObject({ id: "fixture-image", persisted: true });
    expect(h.calls).toEqual({ touch: 1, generate: 0, settle: 0, refund: 0 });
});

test("a pending SADAI background download keeps the completed URL result visible and preserves its ID after saving", async () => {
    let finish!: (image: unknown) => void;
    const download = new Promise((resolve) => { finish = resolve; });
    const h = recoveryHarness(undefined, undefined, { persist: () => download });
    const before = h.job.result;
    const pending = h.run();
    expect(h.downloads).toHaveLength(1);
    expect(h.job.status).toBe("succeeded");
    expect(h.job.result).toBe(before);
    expect(h.job.result.images[0]).toMatchObject({ dataUrl: "https://image.invalid/result.png", persisted: false });
    finish(h.archived);
    expect(await pending).toEqual({ recovered: 1, remaining: 0 });
    expect(h.job.result.images[0]).toMatchObject({ id: "fixture-image", dataUrl: h.archived.dataUrl, persisted: true });
    expect(h.job.result.recoveryPending).toBe(false);
    expect(h.calls).toEqual({ touch: 1, generate: 0, settle: 0, refund: 0 });
});

test("a SADAI background GET timeout leaves the successful temporary result intact without another generation or charge mutation", async () => {
    const h = recoveryHarness(undefined, undefined, { persist: async () => { throw new Error("上游接口响应超时"); } });
    const before = h.job.result;
    expect(await h.run()).toEqual({ recovered: 0, remaining: 1, lastError: "上游接口响应超时" });
    expect(h.downloads).toHaveLength(1);
    expect(h.job.status).toBe("succeeded");
    expect(h.job.result).toBe(before);
    expect(h.job.result.recoveryPending).toBe(true);
    expect(h.calls).toEqual({ touch: 0, generate: 0, settle: 0, refund: 0 });
});

test("body byte limits still cancel oversized responses while timing stays bounded and private", async () => {
    let canceled = false;
    const bytes = new TextEncoder().encode("do-not-log-body");
    const h = harness(async (setTime) => {
        setTime(1_050);
        return new Response(new ReadableStream({
            pull(controller) { setTime(1_100); controller.enqueue(bytes); },
            cancel() { canceled = true; },
        }, { highWaterMark: 0 }), { headers: { "Content-Type": "text/html; private=do-not-log-body" } });
    }, bytes.byteLength - 1);
    await expect(h.run()).rejects.toMatchObject({ status: 413 });
    expect(canceled).toBe(true);
    expect(h.onlyLog()).toMatchObject({ stage: "reading_body", outcome: "failed", responseType: "html", responseBytes: bytes.byteLength, totalMs: 100 });
});

test("caller cancellation remains the original error and is reported separately", async () => {
    const controller = new AbortController();
    const error = new DOMException("do-not-log-error", "AbortError");
    const h = harness(async (setTime) => { setTime(1_080); controller.abort(error); throw error; });
    await expect(h.run(controller.signal)).rejects.toBe(error);
    expect(h.onlyLog()).toMatchObject({ stage: "waiting_headers", outcome: "canceled", totalMs: 80 });
});

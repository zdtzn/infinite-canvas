import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildOpenAiImageRequestOptions, imageResponseItemValue, imageResponseItems, resolveOpenAiImageSize, usesJsonReferenceGeneration } from "./image-request";
import { dragonImageBaseUrl, dragonPromptWithSize, isDragonChatImageModel, isDragonGptImageModel } from "./dragon-image";
import { buildSadaiImageRequestOptions, isSadaiImage2Channel, sadaiImageBaseUrl } from "./sadai-image";
import { isUuImage25Channel } from "./uu-image-async";
import { buildUpstreamUrl } from "./url-policy";
import { readUpstreamErrorMessage, readUpstreamNonJsonError } from "./upstream-error";

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
        buildSadaiImageRequestOptions, isSadaiImage2Channel, sadaiImageBaseUrl, isUuImage25Channel, buildUpstreamUrl,
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
    return { run, onlyLog, requests, input };
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
        ...buildOpenAiImageRequestOptions({ count: input.count, size: resolveOpenAiImageSize(input.size, input.quality, input.model, "https://verysadai.com/v1") }),
    });
    expect(h.requests[0].init.method).toBe("POST");
    expect((h.requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer do-not-log-api-key");
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

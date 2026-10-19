import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { AsyncSemaphore } from "./async-semaphore";
import { detectImageMimeFromBytes } from "./image-mime";
import { promptProxyLane } from "./prompt-cache-policy";
import { createPromptThumbnail, promptThumbnailOptions } from "./prompt-thumbnail";
import { createSharedTasks } from "./shared-task";

const fixture = new Uint8Array(readFileSync(new URL("../../web/public/images/ref/misty-dawn.webp", import.meta.url)));
const original = "https://cdn.jsdelivr.net/gh/example/prompts@main/cover.webp";
const query = new URLSearchParams({ url: original, w: "640", h: "640", fit: "inside", q: "78", output: "webp" });
const thumbnailUrl = new URL(`https://canvas.example/prompt-proxy/thumbnail/?${query}`);
const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const excerpt = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const executable = new Bun.Transpiler({ loader: "ts" }).transformSync(
    excerpt("async function proxyPromptAsset(", "async function serveStatic(") +
    excerpt("async function readResponseBytes(", "function clientIp("),
);
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function harness(upstream: () => Promise<Response> = async () => new Response(fixture)) {
    const directory = mkdtempSync(join(tmpdir(), "prompt-thumbnail-"));
    directories.push(directory);
    const requests: string[] = [];
    let wrote!: () => void;
    const written = new Promise<void>((resolve) => { wrote = resolve; });
    class HttpError extends Error {
        constructor(public status: number, message: string) { super(message); }
    }
    const proxy = vm.runInNewContext(`${executable}\nproxyPromptAsset`, {
        Bun, URL, Response, Uint8Array, AbortController, createHash, join, existsSync, HttpError,
        createPromptThumbnail, promptThumbnailOptions, promptProxyLane, detectImageMimeFromBytes,
        PROMPT_CACHE_ROOT: directory, PROMPT_PROXY_TIMEOUT_MS: 8_000, MAX_PROMPT_PROXY_BYTES: 1024 * 1024,
        PROMPT_IMAGE_MIME_TYPES: new Set(["image/png", "image/jpeg", "image/webp"]),
        promptDownloads: createSharedTasks(),
        promptAssetProxySemaphore: new AsyncSemaphore(3), promptThumbnailProxySemaphore: new AsyncSemaphore(6),
        promptCacheMaintenance: { prune: async () => { wrote(); }, touch: async () => {} },
        assertDiskCapacity: () => {},
        upstreamFetch: async (url: string) => { requests.push(url); return upstream(); },
    });
    const cachePath = join(directory, createHash("sha256").update(`https://images.weserv.nl/?${query}`).digest("hex"));
    return { requests, written, cachePath, request: () => proxy(new Request(thumbnailUrl), thumbnailUrl, "fixture") as Promise<Response> };
}

test("creates a small WebP cover without distorting or upscaling it", async () => {
    const thumbnail = await createPromptThumbnail(fixture, 320, 320);
    expect(await new Bun.Image(thumbnail).metadata()).toEqual({ width: 320, height: 180, format: "webp" });
    expect(thumbnail.byteLength).toBeLessThan(fixture.byteLength);
    expect(await new Bun.Image(await createPromptThumbnail(thumbnail, 640, 640)).metadata()).toEqual({ width: 320, height: 180, format: "webp" });
    await expect(createPromptThumbnail(new Uint8Array([1, 2, 3]), 640, 640)).rejects.toThrow();
});

test("bounds cover sizes and rejects unsafe source addresses", () => {
    expect(promptThumbnailOptions(new URLSearchParams({ url: original, w: "999999", h: "-1" }))).toEqual({ source: original, width: 1280, height: 1 });
    for (const url of ["http://127.0.0.1/private", "https://127.0.0.1/private", "https://user:secret@example.com/image.png", "file:///data/app.sqlite"]) {
        expect(() => promptThumbnailOptions(new URLSearchParams({ url }))).toThrow();
    }
});

test("cold covers fetch the original once, convert locally and reuse their cache", async () => {
    const f = harness();
    const [first, second] = await Promise.all([f.request(), f.request()]);
    expect(first.headers.get("content-type")).toBe("image/webp");
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect(await new Bun.Image(bytes).metadata()).toEqual({ width: 640, height: 360, format: "webp" });
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await (await f.request()).arrayBuffer())).toEqual(bytes);
    expect(f.requests).toEqual([original]);
});

test("rejects oversized upstream responses without caching them", async () => {
    const f = harness(async () => new Response(fixture, { headers: { "content-length": String(2 * 1024 * 1024) } }));
    await expect(f.request()).rejects.toMatchObject({ status: 413 });
    expect(existsSync(f.cachePath)).toBe(false);
});

test("an expired cover displays immediately while one shared refresh runs", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const f = harness(() => pending);
    const cached = await createPromptThumbnail(fixture, 320, 320);
    await Bun.write(f.cachePath, cached);
    await Bun.write(`${f.cachePath}.meta.json`, JSON.stringify({ contentType: "image/webp" }));
    await utimes(f.cachePath, new Date(0), new Date(0));
    try {
        const response = await Promise.race([f.request(), Bun.sleep(500).then(() => null)]);
        expect(response).not.toBeNull();
        expect(new Uint8Array(await response!.arrayBuffer())).toEqual(cached);
        expect(response!.headers.get("cache-control")).toContain("max-age=60");
        expect(new Uint8Array(await (await f.request()).arrayBuffer())).toEqual(cached);
        expect(f.requests).toEqual([original]);
    } finally {
        release(new Response(fixture));
        await f.written;
    }
    expect(await new Bun.Image(Bun.file(f.cachePath)).metadata()).toEqual({ width: 640, height: 360, format: "webp" });
});

import { afterEach, expect, test } from "bun:test";

import { canPromoteServerJobImage, convertImageOutput, readImageBlob } from "./image-storage";

const originalFetch = globalThis.fetch;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
});

test("reads generated image files with the active session", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input, init) => {
        request = { input, init };
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;

    const blob = await readImageBlob("/api/job-files/job/image.png");

    expect(blob.type).toBe("image/png");
    expect(request).toEqual({ input: "/api/job-files/job/image.png", init: { credentials: "same-origin" } });
});

test("decodes canvas data URLs without using fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
        fetchCalled = true;
        throw new TypeError("CSP blocked data URL fetch");
    }) as typeof fetch;

    const blob = await readImageBlob("data:image/png;base64,iVBORw0KGgo=");

    expect(fetchCalled).toBe(false);
    expect(blob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("promotes server job images only when no local format conversion is needed", () => {
    const png = "/api/job-files/job/image.png";

    expect(canPromoteServerJobImage(png, "auto")).toBe(true);
    expect(canPromoteServerJobImage(png, "png")).toBe(true);
    expect(canPromoteServerJobImage(png, "jpeg")).toBe(false);
    expect(canPromoteServerJobImage("/api/assets/image.png", "png")).toBe(false);
    expect(canPromoteServerJobImage("https://example.com/image.png", "png")).toBe(false);
});

test("recognizes a PNG response when the upstream file uses a generic MIME type", async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "Content-Type": "application/octet-stream" } })) as typeof fetch;

    const blob = await readImageBlob("/api/job-files/job/image.png");

    expect(blob.type).toBe("image/png");
});

test("uses the image bytes instead of an incorrect JPEG response header", async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "Content-Type": "image/jpeg" } })) as typeof fetch;

    const blob = await readImageBlob("/api/job-files/job/image.jpg");

    expect(blob.type).toBe("image/png");
});

test("encodes a generated image as the selected JPEG output format", async () => {
    let bitmapClosed = false;
    globalThis.createImageBitmap = (async () => ({ width: 1, height: 1, close: () => (bitmapClosed = true) })) as typeof createImageBitmap;
    globalThis.document = {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => ({ fillStyle: "", fillRect: () => undefined, drawImage: () => undefined }),
            toBlob: (callback: BlobCallback, type?: string) => callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type })),
        }),
    } as unknown as Document;

    const blob = await convertImageOutput(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "jpeg");

    expect(blob.type).toBe("image/jpeg");
    expect(bitmapClosed).toBe(true);
});

test("reports a useful error when the generated image can no longer be read", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "图片不存在" } }), { status: 404, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    await expect(readImageBlob("/api/job-files/missing/image.png")).rejects.toThrow("读取图片失败");
});

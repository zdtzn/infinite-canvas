import { afterEach, expect, test } from "bun:test";

import { canPromoteServerJobImage, collectImageStorageKeysFromHistory, convertImageOutput, createThumbnailFromImageElement, fitImageWithinEdge, publicImageAssetUrl, readImageBlob } from "./image-storage";

const originalFetch = globalThis.fetch;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;

test("releases the fallback object URL when image decoding fails", async () => {
    const OriginalImage = globalThis.Image;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    try {
        globalThis.createImageBitmap = undefined as unknown as typeof createImageBitmap;
        globalThis.document = {} as Document;
        URL.createObjectURL = () => "blob:failed-decode";
        URL.revokeObjectURL = (url) => { revoked.push(url); };
        globalThis.Image = class {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
        } as unknown as typeof Image;
        await expect(convertImageOutput(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "jpeg")).rejects.toThrow("无法解码图片");
        expect(revoked).toEqual(["blob:failed-decode"]);
    } finally {
        globalThis.Image = OriginalImage;
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        globalThis.createImageBitmap = originalCreateImageBitmap;
        globalThis.document = originalDocument;
    }
});

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

    const blob = await readImageBlob("/api/job-files/job/image.png", "user-a");

    expect(blob.type).toBe("image/png");
    expect(request?.input).toBe("/api/job-files/job/image.png");
    expect(request?.init?.credentials).toBe("same-origin");
    expect(new Headers(request?.init?.headers).get("x-expected-user-id")).toBe("user-a");
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

test("keeps an immutable versioned asset URL while hydrating a stored image", () => {
    expect(publicImageAssetUrl("image:original", "/api/assets/image%3Aoriginal?v=123")).toBe("/api/assets/image%3Aoriginal?v=123");
    expect(publicImageAssetUrl("image:original", "/api/job-files/job/image.png")).toBe("/api/assets/image%3Aoriginal");
    expect(publicImageAssetUrl("image:original", "/api/assets/image%3Aother?v=123")).toBe("/api/assets/image%3Aoriginal");
});

test("keeps local images referenced by generation history during cleanup", () => {
    const keys = collectImageStorageKeysFromHistory([
        {
            images: [{ storageKey: "image:generated" }, { thumbnailKey: "image:generated-thumbnail" }],
            references: [{ storageKey: "image:reference" }],
        },
    ]);

    expect(Array.from(keys).sort()).toEqual(["image:generated", "image:generated-thumbnail", "image:reference"]);
});

test("fits generation reference previews within a 1280 pixel edge", () => {
    expect(fitImageWithinEdge(2304, 4096, 1280)).toEqual({ width: 720, height: 1280 });
    expect(fitImageWithinEdge(800, 600, 1280)).toEqual({ width: 800, height: 600 });
});

test("creates an asset thumbnail from the image that the browser already loaded", async () => {
    const source = { naturalWidth: 2000, naturalHeight: 1000 } as HTMLImageElement;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let drawnSource: CanvasImageSource | undefined;
    globalThis.document = {
        createElement: () => ({
            get width() {
                return canvasWidth;
            },
            set width(value: number) {
                canvasWidth = value;
            },
            get height() {
                return canvasHeight;
            },
            set height(value: number) {
                canvasHeight = value;
            },
            getContext: () => ({
                drawImage: (image: CanvasImageSource) => {
                    drawnSource = image;
                },
            }),
            toBlob: (callback: BlobCallback, type?: string) => callback(new Blob(["thumbnail"], { type })),
        }),
    } as unknown as Document;

    const thumbnail = await createThumbnailFromImageElement(source, 512);

    expect(canvasWidth).toBe(512);
    expect(canvasHeight).toBe(256);
    expect(drawnSource).toBe(source);
    expect(thumbnail?.type).toBe("image/webp");
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

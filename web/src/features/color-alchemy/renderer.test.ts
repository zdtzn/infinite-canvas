import { afterEach, expect, test } from "bun:test";
import { loadColorImage, renderColorBlob } from "./renderer";
import { createDefaultColorSettings } from "./settings";
import type { ColorAlchemySource } from "./types";

const source = { key: "test", url: "data:image/png;base64,iVBORw0KGgo=" } as ColorAlchemySource;
const originals = { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap, Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
afterEach(() => {
    Object.assign(globalThis, { fetch: originals.fetch, createImageBitmap: originals.createImageBitmap, Image: originals.Image, document: originals.document });
    URL.createObjectURL = originals.create;
    URL.revokeObjectURL = originals.revoke;
});

test("export cancellation aborts the initial image body read", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    globalThis.fetch = (async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return {
            ok: true,
            blob: () => {
                start();
                return new Promise(() => {});
            },
        } as Response;
    }) as typeof fetch;
    const pending = renderColorBlob({ ...source, url: "/test.png" }, createDefaultColorSettings(), "png", undefined, undefined, { signal: controller.signal });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
});

test("cancelled bitmap decoding rejects promptly and closes its late result", async () => {
    const controller = new AbortController();
    let finish!: (bitmap: ImageBitmap) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    globalThis.createImageBitmap = (() => {
        start();
        return new Promise<ImageBitmap>((resolve) => {
            finish = resolve;
        });
    }) as typeof createImageBitmap;
    const pending = loadColorImage(source, controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    let closed = 0;
    finish({
        width: 1,
        height: 1,
        close: () => {
            closed++;
        },
    } as ImageBitmap);
    await Promise.resolve();
    expect(closed).toBe(1);
});

test("fallback decode cancellation clears the image and releases its URL", async () => {
    const controller = new AbortController();
    const revoked: string[] = [];
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    let element!: FakeImage;
    class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        current = "";
        constructor() {
            element = this;
        }
        set src(value: string) {
            this.current = value;
            if (value) start();
        }
    }
    globalThis.createImageBitmap = undefined as unknown as typeof createImageBitmap;
    globalThis.Image = FakeImage as unknown as typeof Image;
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = (url) => {
        revoked.push(url);
    };
    const pending = loadColorImage(source, controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(element.current).toBe("");
    expect(element.onload).toBeNull();
    expect(element.onerror).toBeNull();
    expect(revoked).toEqual(["blob:test"]);
});

test("fallback decode failure releases its URL", async () => {
    const revoked: string[] = [];
    globalThis.createImageBitmap = undefined as unknown as typeof createImageBitmap;
    globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
            queueMicrotask(() => this.onerror?.());
        }
    } as unknown as typeof Image;
    URL.createObjectURL = () => "blob:failed";
    URL.revokeObjectURL = (url) => {
        revoked.push(url);
    };
    await expect(loadColorImage(source)).rejects.toThrow("图片无法解码");
    expect(revoked).toEqual(["blob:failed"]);
});

test("export failure disposes the decoded bitmap", async () => {
    let closed = 0;
    globalThis.createImageBitmap = (async () => ({
        width: 1,
        height: 1,
        close: () => {
            closed++;
        },
    })) as typeof createImageBitmap;
    globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
    await expect(renderColorBlob(source, createDefaultColorSettings(), "png")).rejects.toThrow("当前浏览器无法导出");
    expect(closed).toBe(1);
});

test("cancelling pending export encoding promptly disposes the decoded bitmap", async () => {
    const controller = new AbortController();
    let closed = 0;
    let encodingStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        encodingStarted = resolve;
    });
    globalThis.createImageBitmap = (async () => ({
        width: 1,
        height: 1,
        close: () => {
            closed++;
        },
    })) as typeof createImageBitmap;
    globalThis.document = {
        createElement: () => ({
            getContext: () => ({
                drawImage: () => {},
                getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }),
                putImageData: () => {},
            }),
            toBlob: () => {
                encodingStarted();
            },
        }),
    } as unknown as Document;
    const pending = renderColorBlob(source, createDefaultColorSettings(), "png", undefined, undefined, { signal: controller.signal });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(closed).toBe(1);
});

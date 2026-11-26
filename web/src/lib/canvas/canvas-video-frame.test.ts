import assert from "node:assert/strict";
import { test } from "bun:test";
import { captureVideoFrame } from "./canvas-media-tools";

async function withVideoFrame(
    run: (fixture: {
        capture: () => Promise<File>;
        controller: AbortController;
        encoded: Promise<BlobCallback>;
        canvas: { width: number; height: number };
        revoked: string[];
    }) => Promise<void>,
    options: { encodingError?: Error; teardownError?: Error } = {},
) {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const controller = new AbortController();
    const encoded = Promise.withResolvers<BlobCallback>();
    const revoked: string[] = [];
    const video = Object.assign(new EventTarget(), {
        src: "",
        duration: 2,
        readyState: 2,
        videoWidth: 320,
        videoHeight: 180,
        pause() {},
        removeAttribute() { this.src = ""; },
        load() {
            if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
            else if (options.teardownError) throw options.teardownError;
        },
    });
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob(callback: BlobCallback, mimeType: string) {
            assert.equal(mimeType, "image/png");
            if (options.encodingError) throw options.encodingError;
            encoded.resolve(callback);
        },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag: string) => tag === "video" ? video : canvas } });
    URL.createObjectURL = () => "blob:video-frame";
    URL.revokeObjectURL = (url) => { revoked.push(url); };
    try {
        await run({ capture: () => captureVideoFrame(new Blob(["video"]), "first", 0, controller.signal), controller, encoded: encoded.promise, canvas, revoked });
    } finally {
        controller.abort();
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
        else Reflect.deleteProperty(globalThis, "document");
    }
}

test("captures the decoded frame as PNG and releases its resources", async () => {
    await withVideoFrame(async ({ capture, encoded, canvas, revoked }) => {
        const result = capture();
        const callback = await encoded;
        assert.equal(canvas.width, 320);
        assert.equal(canvas.height, 180);
        callback(new Blob(["png"], { type: "image/png" }));
        const file = await result;
        assert.equal(file.type, "image/png");
        assert.equal(await file.text(), "png");
        assert.deepEqual(revoked, ["blob:video-frame"]);
        assert.equal(canvas.width * canvas.height, 0);
    });
});

test("cancels encoding without waiting for the browser callback and ignores its late result", async () => {
    await withVideoFrame(async ({ capture, encoded, controller, canvas, revoked }) => {
        const reason = new DOMException("已取消", "AbortError");
        const result = capture();
        const rejected = assert.rejects(result, (error) => error === reason);
        const callback = await encoded;
        controller.abort(reason);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([rejected, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("取消后仍在等待图片编码")), 500); })]);
        } finally {
            clearTimeout(timer);
        }
        assert.deepEqual(revoked, ["blob:video-frame"]);
        assert.equal(canvas.width * canvas.height, 0);
        callback(new Blob(["late"], { type: "image/png" }));
        await assert.rejects(result, (error) => error === reason);
    });
});

test("rejects empty encoding results and releases the media URL", async () => {
    await withVideoFrame(async ({ capture, encoded, revoked }) => {
        const result = capture();
        const rejected = assert.rejects(result, /截帧失败/);
        (await encoded)(null);
        await rejected;
        assert.deepEqual(revoked, ["blob:video-frame"]);
    });
});

test("releases resources when canvas encoding throws", async () => {
    const reason = new Error("encoding failed");
    await withVideoFrame(async ({ capture, revoked }) => {
        await assert.rejects(capture(), (error) => error === reason);
        assert.deepEqual(revoked, ["blob:video-frame"]);
    }, { encodingError: reason });
});

test("still revokes the media URL when video teardown throws", async () => {
    const reason = new Error("video teardown failed");
    await withVideoFrame(async ({ capture, encoded, revoked }) => {
        const result = capture();
        const rejected = assert.rejects(result, (error) => error === reason);
        (await encoded)(new Blob(["png"], { type: "image/png" }));
        await rejected;
        assert.deepEqual(revoked, ["blob:video-frame"]);
    }, { teardownError: reason });
});

import { describe, expect, test } from "bun:test";

import { ColorPreviewWorkerClient, type ColorPreviewWorkerLike } from "./color-preview-worker-client";
import { createDefaultColorSettings } from "./settings";

describe("Color preview worker client", () => {
    test("transfers the preview source once and resolves rendered frames", async () => {
        const worker = new FakePreviewWorker();
        const client = new ColorPreviewWorkerClient(worker);
        const pixels = new Uint8ClampedArray([12, 34, 56, 255]);

        client.initialize({ data: pixels, width: 1, height: 1 } as ImageData);
        expect(worker.messages[0]?.message).toMatchObject({ type: "initialize", width: 1, height: 1 });
        expect(worker.messages[0]?.transfer).toHaveLength(1);

        const rendered = client.render(createDefaultColorSettings(), 760);
        const request = worker.messages[1]?.message as { id: number };
        const output = new Uint8ClampedArray([20, 40, 60, 255]);
        worker.respond({ type: "rendered", id: request.id, ok: true, width: 1, height: 1, pixels: output.buffer });

        await expect(rendered).resolves.toMatchObject({ width: 1, height: 1 });
        expect(Array.from(new Uint8ClampedArray((await rendered).pixels))).toEqual([20, 40, 60, 255]);

        client.dispose();
        expect(worker.terminated).toBe(true);
    });

    test("rejects pending renders when the worker fails", async () => {
        const worker = new FakePreviewWorker();
        const client = new ColorPreviewWorkerClient(worker);
        client.initialize({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 } as ImageData);

        const rendered = client.render(createDefaultColorSettings(), 760);
        worker.fail();

        await expect(rendered).rejects.toThrow("后台预览线程不可用");
        client.dispose();
    });
});

class FakePreviewWorker implements ColorPreviewWorkerLike {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    messages: Array<{ message: unknown; transfer: Transferable[] }> = [];
    terminated = false;

    postMessage(message: unknown, transfer: Transferable[]): void;
    postMessage(message: unknown, options?: StructuredSerializeOptions): void;
    postMessage(message: unknown, transferOrOptions: Transferable[] | StructuredSerializeOptions = []) {
        this.messages.push({ message, transfer: Array.isArray(transferOrOptions) ? transferOrOptions : transferOrOptions.transfer || [] });
    }

    terminate() {
        this.terminated = true;
    }

    respond(message: unknown) {
        this.onmessage?.({ data: message } as MessageEvent);
    }

    fail() {
        this.onerror?.({ message: "worker failed" } as ErrorEvent);
    }
}

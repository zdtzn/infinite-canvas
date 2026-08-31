import type { ColorSettings } from "./types";

type ColorPreviewWorkerResponse = { type: "rendered"; id: number; ok: true; width: number; height: number; pixels: ArrayBuffer } | { type: "rendered"; id: number; ok: false; error: string };

export type ColorPreviewFrame = {
    width: number;
    height: number;
    pixels: ArrayBuffer;
};

export type ColorPreviewWorkerLike = {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: unknown, transfer: Transferable[]): void;
    postMessage(message: unknown, options?: StructuredSerializeOptions): void;
    terminate: () => void;
};

export class ColorPreviewWorkerClient {
    private nextRequestId = 1;
    private disposed = false;
    private readonly pending = new Map<number, { resolve: (frame: ColorPreviewFrame) => void; reject: (reason: Error) => void }>();

    constructor(private readonly worker: ColorPreviewWorkerLike) {
        worker.onmessage = (event) => this.handleMessage(event.data as ColorPreviewWorkerResponse);
        worker.onerror = () => this.failPending(new Error("后台预览线程不可用"));
    }

    initialize(imageData: ImageData) {
        if (this.disposed) throw new Error("后台预览线程已关闭");
        const pixels = new Uint8ClampedArray(imageData.data);
        this.worker.postMessage({ type: "initialize", width: imageData.width, height: imageData.height, pixels: pixels.buffer }, [pixels.buffer]);
    }

    render(settings: ColorSettings, maxEdge: number) {
        if (this.disposed) return Promise.reject(new Error("后台预览线程已关闭"));
        const id = this.nextRequestId;
        this.nextRequestId += 1;
        return new Promise<ColorPreviewFrame>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ type: "render", id, settings, maxEdge });
        });
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.terminate();
        this.failPending(new Error("后台预览线程已关闭"));
    }

    private handleMessage(message: ColorPreviewWorkerResponse) {
        if (message.type !== "rendered") return;
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (!message.ok) {
            request.reject(new Error(message.error || "后台预览失败"));
            return;
        }
        request.resolve({ width: message.width, height: message.height, pixels: message.pixels });
    }

    private failPending(error: Error) {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }
}

export function createColorPreviewWorkerClient() {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    try {
        return new ColorPreviewWorkerClient(new Worker(new URL("./color-preview.worker.ts", import.meta.url), { type: "module" }));
    } catch (error) {
        console.warn("color_preview_worker_unavailable", error instanceof Error ? error.message : error);
        return null;
    }
}

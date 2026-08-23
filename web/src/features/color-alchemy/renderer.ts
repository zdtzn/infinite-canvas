import { applyColorSettingsToImageData, extractColorAnalysis } from "./color-engine";
import { loadFilmLut } from "./film-lut";
import type { ColorAlchemySource, ColorAnalysis, ColorExportFormat, ColorSettings } from "./types";
import { readImageBlob, resolveImageUrl } from "@/services/image-storage";

export type LoadedColorImage = {
    image: CanvasImageSource;
    width: number;
    height: number;
    dispose: () => void;
};

export type ColorRenderProgress = {
    phase: "loading" | "processing" | "encoding";
    progress: number;
};

export type ColorRenderOptions = {
    signal?: AbortSignal;
    onProgress?: (progress: ColorRenderProgress) => void;
};

export async function loadColorImage(source: ColorAlchemySource): Promise<LoadedColorImage> {
    const url = await resolveImageUrl(source.storageKey, source.url);
    const blob = await readImageBlob(url || source.url);
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    }

    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("图片无法解码，请尝试重新上传"));
        element.src = objectUrl;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
}

export function drawOriginalColorPreview(source: LoadedColorImage, canvas: HTMLCanvasElement, maxEdge = 1_400) {
    const dimensions = fitDimensions(source.width, source.height, maxEdge);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器无法预览图片");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
    return dimensions;
}

export async function renderColorPreview(source: LoadedColorImage, canvas: HTMLCanvasElement, settings: ColorSettings, maxEdge = 1_400) {
    const dimensions = drawOriginalColorPreview(source, canvas, maxEdge);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器无法预览调色结果");
    await processCanvas(context, canvas.width, canvas.height, settings);
    return dimensions;
}

export function analyzeLoadedColorImage(source: LoadedColorImage): ColorAnalysis {
    const dimensions = fitDimensions(source.width, source.height, 360);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法分析图片色彩");
    context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
    return extractColorAnalysis(context.getImageData(0, 0, canvas.width, canvas.height));
}

export async function analyzeColorSource(source: ColorAlchemySource) {
    const loaded = await loadColorImage(source);
    try {
        return analyzeLoadedColorImage(loaded);
    } finally {
        loaded.dispose();
    }
}

export async function renderColorBlob(source: ColorAlchemySource, settings: ColorSettings, format: ColorExportFormat, quality = 0.92, maxEdge?: number, options?: ColorRenderOptions) {
    throwIfAborted(options?.signal);
    options?.onProgress?.({ phase: "loading", progress: 0.04 });
    const loaded = await loadColorImage(source);
    try {
        throwIfAborted(options?.signal);
        options?.onProgress?.({ phase: "loading", progress: 0.12 });
        const dimensions = maxEdge ? fitDimensions(loaded.width, loaded.height, maxEdge) : { width: loaded.width, height: loaded.height };
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const mimeType = exportMimeType(format);
        const context = canvas.getContext("2d", { alpha: mimeType !== "image/jpeg", willReadFrequently: true });
        if (!context) throw new Error("当前浏览器无法导出调色结果");
        if (mimeType === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
        const workerBlob = await renderWithWorkerIfAvailable(context, canvas.width, canvas.height, settings, format, quality, options);
        if (workerBlob) return workerBlob;
        await processCanvas(context, canvas.width, canvas.height, settings, options);
        throwIfAborted(options?.signal);
        options?.onProgress?.({ phase: "encoding", progress: 0.94 });
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, format === "png" ? undefined : Math.min(1, Math.max(0.4, quality))));
        if (!blob) throw new Error("导出失败：浏览器未能编码图片");
        return blob;
    } finally {
        loaded.dispose();
    }
}

export function colorExportExtension(format: ColorExportFormat) {
    return format === "jpeg" ? "jpg" : format;
}

async function processCanvas(context: CanvasRenderingContext2D, width: number, height: number, settings: ColorSettings, options?: ColorRenderOptions) {
    throwIfAborted(options?.signal);
    const lut = await loadFilmLut(settings.lutId);
    const pixels = width * height;
    if (pixels <= 4_000_000) {
        const imageData = context.getImageData(0, 0, width, height);
        applyColorSettingsToImageData(imageData, width, height, settings, 0, 0, width, height, lut);
        context.putImageData(imageData, 0, 0);
        options?.onProgress?.({ phase: "processing", progress: 0.84 });
        return;
    }

    const tileSize = 768;
    const halo = 1;
    const totalTiles = Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
    let completedTiles = 0;
    for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
            throwIfAborted(options?.signal);
            const tileWidth = Math.min(tileSize, width - x);
            const tileHeight = Math.min(tileSize, height - y);
            const readX = Math.max(0, x - halo);
            const readY = Math.max(0, y - halo);
            const readRight = Math.min(width, x + tileWidth + halo);
            const readBottom = Math.min(height, y + tileHeight + halo);
            const imageData = context.getImageData(readX, readY, readRight - readX, readBottom - readY);
            applyColorSettingsToImageData(imageData, imageData.width, imageData.height, settings, readX, readY, width, height, lut);
            context.putImageData(imageData, x, y, x - readX, y - readY, tileWidth, tileHeight);
            completedTiles += 1;
            options?.onProgress?.({ phase: "processing", progress: 0.12 + (completedTiles / totalTiles) * 0.72 });
            await yieldToMainThread();
        }
    }
}

async function renderWithWorkerIfAvailable(context: CanvasRenderingContext2D, width: number, height: number, settings: ColorSettings, format: ColorExportFormat, quality: number, options?: ColorRenderOptions) {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    throwIfAborted(options?.signal);
    const source = context.getImageData(0, 0, width, height).data;
    const worker = new Worker(new URL("./color-render.worker.ts", import.meta.url), { type: "module" });
    const requestId = 1;
    let abortHandler: (() => void) | undefined;
    try {
        const response = await new Promise<{ buffer: ArrayBuffer; mimeType: string }>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<{ id: number; type?: "progress"; ok: boolean; buffer?: ArrayBuffer; mimeType?: string; error?: string; cancelled?: boolean; progress?: number }>) => {
                const payload = event.data;
                if (payload.id !== requestId) return;
                if (payload.type === "progress") {
                    options?.onProgress?.({ phase: payload.progress && payload.progress >= 0.9 ? "encoding" : "processing", progress: Math.max(0, Math.min(1, payload.progress || 0)) });
                    return;
                }
                if (!payload.ok || !payload.buffer) {
                    reject(payload.cancelled ? new DOMException("导出已取消", "AbortError") : new Error(payload.error || "后台导出失败"));
                    return;
                }
                options?.onProgress?.({ phase: "encoding", progress: 0.98 });
                resolve({ buffer: payload.buffer, mimeType: payload.mimeType || exportMimeType(format) });
            };
            worker.onerror = () => reject(new Error("后台导出线程不可用"));
            abortHandler = () => {
                worker.postMessage({ type: "cancel", id: requestId });
                reject(new DOMException("导出已取消", "AbortError"));
            };
            if (options?.signal) {
                if (options.signal.aborted) return abortHandler();
                options.signal.addEventListener("abort", abortHandler, { once: true });
            }
            worker.postMessage({ type: "render", id: requestId, width, height, pixels: source.buffer, settings, format, quality }, [source.buffer]);
        });
        return new Blob([response.buffer], { type: response.mimeType });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        console.warn("color_render_worker_fallback", error instanceof Error ? error.message : error);
        return null;
    } finally {
        if (options?.signal && abortHandler) options.signal.removeEventListener("abort", abortHandler);
        worker.terminate();
    }
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("导出已取消", "AbortError");
}

function yieldToMainThread() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function fitDimensions(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function exportMimeType(format: ColorExportFormat) {
    return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const)[format];
}

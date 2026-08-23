import { applyColorSettingsToImageData } from "./color-engine";
import { loadFilmLut } from "./film-lut";
import type { ColorExportFormat, ColorSettings } from "./types";

type RenderRequest = {
    type: "render";
    id: number;
    width: number;
    height: number;
    pixels: ArrayBuffer;
    settings: ColorSettings;
    format: ColorExportFormat;
    quality: number;
};

type CancelRequest = { type: "cancel"; id: number };

type RenderResponse =
    | { id: number; type: "progress"; progress: number; ok: false }
    | { id: number; ok: true; buffer: ArrayBuffer; mimeType: string }
    | { id: number; ok: false; error: string; cancelled?: boolean };

const scope = globalThis as typeof globalThis & {
    onmessage: ((event: MessageEvent<RenderRequest | CancelRequest>) => void) | null;
    postMessage: (message: RenderResponse, transfer?: Transferable[]) => void;
};

const cancelledRequests = new Set<number>();

scope.onmessage = (event) => {
    if (event.data.type === "cancel") {
        cancelledRequests.add(event.data.id);
        return;
    }
    void render(event.data);
};

async function render(request: RenderRequest) {
    try {
        assertNotCancelled(request.id);
        if (typeof OffscreenCanvas === "undefined") throw new Error("当前浏览器不支持后台图片导出");
        const mimeType = exportMimeType(request.format);
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext("2d", { alpha: mimeType !== "image/jpeg" });
        if (!context) throw new Error("当前浏览器无法创建后台导出画布");
        if (mimeType === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, request.width, request.height);
        }

        const source = new Uint8ClampedArray(request.pixels);
        const lut = await loadFilmLut(request.settings.lutId);
        await processPixels(context, source, request.width, request.height, request.settings, lut, request.id);
        assertNotCancelled(request.id);
        scope.postMessage({ id: request.id, type: "progress", progress: 0.92, ok: false });
        const blob = await canvas.convertToBlob({
            type: mimeType,
            ...(request.format === "png" ? {} : { quality: Math.min(1, Math.max(0.4, request.quality)) }),
        });
        const buffer = await blob.arrayBuffer();
        assertNotCancelled(request.id);
        scope.postMessage({ id: request.id, ok: true, buffer, mimeType: blob.type || mimeType }, [buffer]);
    } catch (error) {
        const cancelled = error instanceof RenderCancelledError;
        scope.postMessage({ id: request.id, ok: false, cancelled, error: error instanceof Error ? error.message : "后台导出失败" });
    } finally {
        cancelledRequests.delete(request.id);
    }
}

async function processPixels(
    context: OffscreenCanvasRenderingContext2D,
    source: Uint8ClampedArray,
    width: number,
    height: number,
    settings: ColorSettings,
    lut: Awaited<ReturnType<typeof loadFilmLut>>,
    requestId: number,
) {
    const pixels = width * height;
    if (pixels <= 4_000_000) {
        assertNotCancelled(requestId);
        const imageData = new ImageData(source as Uint8ClampedArray<ArrayBuffer>, width, height);
        applyColorSettingsToImageData(imageData, width, height, settings, 0, 0, width, height, lut);
        context.putImageData(imageData, 0, 0);
        scope.postMessage({ id: requestId, type: "progress", progress: 0.84, ok: false });
        return;
    }

    const tileSize = 768;
    const halo = 1;
    const totalTiles = Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
    let completedTiles = 0;
    for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
            assertNotCancelled(requestId);
            const tileWidth = Math.min(tileSize, width - x);
            const tileHeight = Math.min(tileSize, height - y);
            const readX = Math.max(0, x - halo);
            const readY = Math.max(0, y - halo);
            const readWidth = Math.min(width, x + tileWidth + halo) - readX;
            const readHeight = Math.min(height, y + tileHeight + halo) - readY;
            const tile = new Uint8ClampedArray(readWidth * readHeight * 4);
            for (let row = 0; row < readHeight; row += 1) {
                const sourceOffset = ((readY + row) * width + readX) * 4;
                const targetOffset = row * readWidth * 4;
                tile.set(source.subarray(sourceOffset, sourceOffset + readWidth * 4), targetOffset);
            }
            const imageData = new ImageData(tile as Uint8ClampedArray<ArrayBuffer>, readWidth, readHeight);
            applyColorSettingsToImageData(imageData, readWidth, readHeight, settings, readX, readY, width, height, lut);
            context.putImageData(imageData, x, y, x - readX, y - readY, tileWidth, tileHeight);
            completedTiles += 1;
            scope.postMessage({ id: requestId, type: "progress", progress: 0.12 + (completedTiles / totalTiles) * 0.72, ok: false });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }
}

class RenderCancelledError extends Error {}

function assertNotCancelled(id: number) {
    if (cancelledRequests.has(id)) throw new RenderCancelledError("导出已取消");
}

function exportMimeType(format: ColorExportFormat) {
    return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const)[format];
}

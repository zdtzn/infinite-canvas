import { applyColorSettingsToImageData } from "./color-engine";
import { loadFilmLut } from "./film-lut";
import type { ColorExportFormat, ColorSettings } from "./types";

type RenderRequest = {
    id: number;
    width: number;
    height: number;
    pixels: ArrayBuffer;
    settings: ColorSettings;
    format: ColorExportFormat;
    quality: number;
};

type RenderResponse =
    | { id: number; ok: true; buffer: ArrayBuffer; mimeType: string }
    | { id: number; ok: false; error: string };

const scope = globalThis as typeof globalThis & {
    onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
    postMessage: (message: RenderResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
    void render(event.data);
};

async function render(request: RenderRequest) {
    try {
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
        processPixels(context, source, request.width, request.height, request.settings, lut);
        const blob = await canvas.convertToBlob({
            type: mimeType,
            ...(request.format === "png" ? {} : { quality: Math.min(1, Math.max(0.4, request.quality)) }),
        });
        const buffer = await blob.arrayBuffer();
        scope.postMessage({ id: request.id, ok: true, buffer, mimeType: blob.type || mimeType }, [buffer]);
    } catch (error) {
        scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "后台导出失败" });
    }
}

function processPixels(
    context: OffscreenCanvasRenderingContext2D,
    source: Uint8ClampedArray,
    width: number,
    height: number,
    settings: ColorSettings,
    lut: Awaited<ReturnType<typeof loadFilmLut>>,
) {
    const pixels = width * height;
    if (pixels <= 4_000_000) {
        const imageData = new ImageData(source as Uint8ClampedArray<ArrayBuffer>, width, height);
        applyColorSettingsToImageData(imageData, width, height, settings, 0, 0, width, height, lut);
        context.putImageData(imageData, 0, 0);
        return;
    }

    const tileSize = 768;
    const halo = 1;
    for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
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
        }
    }
}

function exportMimeType(format: ColorExportFormat) {
    return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const)[format];
}

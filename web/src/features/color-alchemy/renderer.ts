import { applyColorSettingsToImageData, extractColorAnalysis } from "./color-engine";
import type { ColorAlchemySource, ColorAnalysis, ColorExportFormat, ColorSettings } from "./types";
import { readImageBlob, resolveImageUrl } from "@/services/image-storage";

export type LoadedColorImage = {
    image: CanvasImageSource;
    width: number;
    height: number;
    dispose: () => void;
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

export function renderColorPreview(source: LoadedColorImage, canvas: HTMLCanvasElement, settings: ColorSettings, maxEdge = 1_400) {
    const dimensions = drawOriginalColorPreview(source, canvas, maxEdge);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器无法预览调色结果");
    processCanvas(context, canvas.width, canvas.height, settings);
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

export async function renderColorBlob(source: ColorAlchemySource, settings: ColorSettings, format: ColorExportFormat, quality = 0.92, maxEdge?: number) {
    const loaded = await loadColorImage(source);
    try {
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
        processCanvas(context, canvas.width, canvas.height, settings);
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

function processCanvas(context: CanvasRenderingContext2D, width: number, height: number, settings: ColorSettings) {
    const pixels = width * height;
    if (pixels <= 4_000_000) {
        const imageData = context.getImageData(0, 0, width, height);
        applyColorSettingsToImageData(imageData, width, height, settings);
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
            const readRight = Math.min(width, x + tileWidth + halo);
            const readBottom = Math.min(height, y + tileHeight + halo);
            const imageData = context.getImageData(readX, readY, readRight - readX, readBottom - readY);
            applyColorSettingsToImageData(imageData, imageData.width, imageData.height, settings, readX, readY, width, height);
            context.putImageData(imageData, x, y, x - readX, y - readY, tileWidth, tileHeight);
        }
    }
}

function fitDimensions(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function exportMimeType(format: ColorExportFormat) {
    return ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const)[format];
}

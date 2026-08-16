import { readImageBlob, resolveImageUrl } from "@/services/image-storage";
import { requestServerCutout } from "@/services/server-api";

import type { ColorAlchemySource } from "./types";

export type CutoutSettings = {
    edgeEnhancement: number;
    edgeSoftness: number;
    decontaminate: number;
};

export const DEFAULT_CUTOUT_SETTINGS: CutoutSettings = {
    edgeEnhancement: 62,
    edgeSoftness: 18,
    decontaminate: 48,
};

export function normalizeCutoutSettings(value?: Partial<CutoutSettings>): CutoutSettings {
    return {
        edgeEnhancement: clamp(Number(value?.edgeEnhancement ?? DEFAULT_CUTOUT_SETTINGS.edgeEnhancement), 0, 100),
        edgeSoftness: clamp(Number(value?.edgeSoftness ?? DEFAULT_CUTOUT_SETTINGS.edgeSoftness), 0, 100),
        decontaminate: clamp(Number(value?.decontaminate ?? DEFAULT_CUTOUT_SETTINGS.decontaminate), 0, 100),
    };
}

export async function removeBackgroundFromSource(source: ColorAlchemySource, onProgress?: (progress: number) => void, signal?: AbortSignal) {
    const url = await resolveImageUrl(source.storageKey, source.url);
    const blob = await readImageBlob(url || source.url);
    onProgress?.(8);
    const result = await requestServerCutout(blob, undefined, signal);
    onProgress?.(100);
    return result;
}

export function cutoutErrorMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error || "");
    const normalized = detail.toLowerCase();
    if (normalized.includes("previous call to initwasm() failed") || normalized.includes("runtime aborted")) {
        return "抠图运行组件初始化失败，请刷新页面后重试；若仍失败，请清除本站缓存后重新打开。";
    }
    if (normalized.includes("resource metadata not found") || normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
        return "抠图模型加载失败，请检查网络后重试。首次使用需要下载模型资源，之后会由浏览器缓存。";
    }
    if (normalized.includes("out of memory") || normalized.includes("memory access out of bounds")) {
        return "当前设备可用内存不足，建议关闭其他页面、缩小原图后再试。";
    }
    if (/[\u3400-\u9fff]/.test(detail)) return detail;
    return "抠图处理失败，请刷新页面后重试。";
}

export async function renderCutoutPreview(input: Blob, canvas: HTMLCanvasElement, settings: CutoutSettings, maxEdge = 1_400) {
    const loaded = await loadRaster(input);
    try {
        const dimensions = fitDimensions(loaded.width, loaded.height, maxEdge);
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
        if (!context) throw new Error("当前浏览器无法处理透明图层");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        refineCutoutPixels(imageData, settings);
        context.putImageData(imageData, 0, 0);
        return dimensions;
    } finally {
        loaded.dispose();
    }
}

export async function renderCutoutBlob(input: Blob, settings: CutoutSettings, format: "png" | "webp" = "png", quality = 0.92, maxEdge?: number) {
    const loaded = await loadRaster(input);
    try {
        const dimensions = maxEdge ? fitDimensions(loaded.width, loaded.height, maxEdge) : { width: loaded.width, height: loaded.height };
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
        if (!context) throw new Error("当前浏览器无法导出透明图层");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        refineCutoutPixels(imageData, settings);
        context.putImageData(imageData, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === "png" ? "image/png" : "image/webp", format === "png" ? undefined : clamp(quality, 0.4, 1)));
        if (!blob) throw new Error("透明图层导出失败，请重试");
        return blob;
    } finally {
        loaded.dispose();
    }
}

export function refineCutoutPixels(imageData: ImageData, settings: CutoutSettings) {
    const normalized = normalizeCutoutSettings(settings);
    const { data, width, height } = imageData;
    const original = new Uint8ClampedArray(data);
    const alpha = new Float32Array(width * height);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = original[index * 4 + 3];

    const softness = normalized.edgeSoftness / 100;
    const enhancement = normalized.edgeEnhancement / 100;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const pixel = y * width + x;
            const current = alpha[pixel];
            const average = neighborhoodAverage(alpha, width, height, x, y);
            let next = current + (average - current) * softness * 0.62;
            next += (next - average) * enhancement * 0.95;
            data[pixel * 4 + 3] = Math.round(clamp(next, 0, 255));
        }
    }

    const decontaminate = normalized.decontaminate / 100;
    if (!decontaminate) return imageData;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const pixel = y * width + x;
            const sourceAlpha = alpha[pixel];
            if (sourceAlpha <= 0 || sourceAlpha >= 250) continue;
            const foreground = foregroundNeighborColor(original, alpha, width, height, x, y);
            if (!foreground) continue;
            const amount = (1 - sourceAlpha / 255) * decontaminate * 0.72;
            const index = pixel * 4;
            for (let channel = 0; channel < 3; channel += 1) data[index + channel] = Math.round(original[index + channel] + (foreground[channel] - original[index + channel]) * amount);
        }
    }
    return imageData;
}

async function loadRaster(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; dispose: () => void }> {
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    }
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("透明图层无法读取，请重新尝试"));
        element.src = objectUrl;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
}

function neighborhoodAverage(values: Float32Array, width: number, height: number, x: number, y: number) {
    let total = 0;
    let count = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            total += values[nextY * width + nextX];
            count += 1;
        }
    }
    return count ? total / count : values[y * width + x];
}

function foregroundNeighborColor(data: Uint8ClampedArray, alpha: Float32Array, width: number, height: number, x: number, y: number) {
    const color = [0, 0, 0];
    let count = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const pixel = nextY * width + nextX;
            if (alpha[pixel] < 235) continue;
            const index = pixel * 4;
            color[0] += data[index];
            color[1] += data[index + 1];
            color[2] += data[index + 2];
            count += 1;
        }
    }
    return count ? (color.map((value) => value / count) as [number, number, number]) : null;
}

function fitDimensions(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function clamp(value: number, min: number, max: number) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

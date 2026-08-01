import { runWithConcurrency } from "@/lib/async-pool";

export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_UPSCALE_LONG_EDGE = 4096;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
    horizontalLines?: number[];
    verticalLines?: number[];
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    blob: Blob;
    width: number;
    height: number;
};

export type ImageSplitLayoutCell = {
    row: number;
    column: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

export const IMAGE_SPLIT_CONCURRENCY = 3;

export async function cropImageBlob(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        const width = Math.ceil(crop.width * image.width);
        const height = Math.ceil(crop.height * image.height);
        return { blob: await drawCropBlob(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), width, height), width, height };
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return { blob: await drawCropBlob(image, sx, sy, size, size), width: size, height: size };
}

export async function splitImageBlobs(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const xCuts = buildSplitCuts(params.verticalLines, image.width, Math.max(1, Math.floor(params.columns)));
    const yCuts = buildSplitCuts(params.horizontalLines, image.height, Math.max(1, Math.floor(params.rows)));
    const regions: Array<{ row: number; column: number; sx: number; sy: number; sw: number; sh: number }> = [];

    for (let row = 0; row < yCuts.length - 1; row += 1) {
        const sy = yCuts[row];
        const sh = yCuts[row + 1] - sy;
        for (let column = 0; column < xCuts.length - 1; column += 1) {
            const sx = xCuts[column];
            const sw = xCuts[column + 1] - sx;
            regions.push({ row, column, sx, sy, sw, sh });
        }
    }

    return runWithConcurrency(regions, IMAGE_SPLIT_CONCURRENCY, async ({ row, column, sx, sy, sw, sh }) => ({
        row,
        column,
        blob: await drawCropBlob(image, sx, sy, sw, sh),
        width: sw,
        height: sh,
    }));
}

export function buildSplitLayout(
    pieces: Array<Pick<ImageSplitPiece, "row" | "column" | "width" | "height">>,
    displayWidth: number,
    displayHeight: number,
    gap: number,
): ImageSplitLayoutCell[] {
    if (!pieces.length) return [];
    const columnWidths: number[] = [];
    const rowHeights: number[] = [];
    for (const piece of pieces) {
        columnWidths[piece.column] = Math.max(columnWidths[piece.column] || 0, piece.width);
        rowHeights[piece.row] = Math.max(rowHeights[piece.row] || 0, piece.height);
    }

    const sourceWidth = Math.max(1, columnWidths.reduce((total, width) => total + width, 0));
    const sourceHeight = Math.max(1, rowHeights.reduce((total, height) => total + height, 0));
    const scaledColumns = columnWidths.map((width) => (Math.max(1, displayWidth) * width) / sourceWidth);
    const scaledRows = rowHeights.map((height) => (Math.max(1, displayHeight) * height) / sourceHeight);
    const columnOffsets = cumulativeOffsets(scaledColumns, gap);
    const rowOffsets = cumulativeOffsets(scaledRows, gap);

    return pieces.map((piece) => ({
        row: piece.row,
        column: piece.column,
        x: columnOffsets[piece.column] || 0,
        y: rowOffsets[piece.row] || 0,
        width: scaledColumns[piece.column] || 1,
        height: scaledRows[piece.row] || 1,
    }));
}

function cumulativeOffsets(sizes: number[], gap: number) {
    const offsets: number[] = [];
    let offset = 0;
    for (const size of sizes) {
        offsets.push(offset);
        offset += size + Math.max(0, gap);
    }
    return offsets;
}

function buildSplitCuts(lines: number[] | undefined, size: number, count: number) {
    if (!lines?.length) return Array.from({ length: count + 1 }, (_, index) => Math.floor((index * size) / count));
    return [0, ...lines.map((line) => Math.round(line * size)).filter((line) => line > 0 && line < size).sort((a, b) => a - b), size];
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 60;
    const pitch = params.pitchAngle / 45;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const wideScale = params.wideAngle ? 0.88 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleImageBlob(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    const canvas = params.algorithm === "high" ? drawStepUpscaleCanvas(image, width, height) : drawResizeCanvas(image, image.width, image.height, width, height, params.algorithm);
    try {
        return { blob: await canvasToBlob(canvas), width, height };
    } finally {
        releaseCanvas(canvas);
    }
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const { blob } = await upscaleImageBlob(dataUrl, params);
    return blobToDataUrl(blob);
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function drawCropBlob(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to create an image slice");
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    try {
        return await canvasToBlob(canvas);
    } finally {
        releaseCanvas(canvas);
    }
}

function drawStepUpscaleCanvas(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    try {
        while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
            const nextWidth = sourceWidth * 2;
            const nextHeight = sourceHeight * 2;
            const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
            if (source instanceof HTMLCanvasElement) releaseCanvas(source);
            source = next;
            sourceWidth = nextWidth;
            sourceHeight = nextHeight;
        }

        const output = drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, "high");
        if (source instanceof HTMLCanvasElement) releaseCanvas(source);
        return output;
    } catch (error) {
        if (source instanceof HTMLCanvasElement) releaseCanvas(source);
        throw error;
    }
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to create an image canvas");
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const timeout = globalThis.setTimeout(() => finish(() => reject(new Error("Timed out while loading the source image"))), 15_000);
        const finish = (callback: () => void) => {
            globalThis.clearTimeout(timeout);
            image.onload = null;
            image.onerror = null;
            callback();
        };
        image.decoding = "async";
        image.onload = () => finish(() => resolve(image));
        image.onerror = () => finish(() => reject(new Error("Failed to load the source image")));
        image.src = dataUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode the image"))), "image/png");
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read the resized image"));
        reader.readAsDataURL(blob);
    });
}

function releaseCanvas(canvas: HTMLCanvasElement) {
    canvas.width = 1;
    canvas.height = 1;
}

import { applyColorSettingsToImageData } from "./color-engine";
import { loadFilmLut } from "./film-lut";
import type { ColorSettings } from "./types";

type InitializeRequest = {
    type: "initialize";
    width: number;
    height: number;
    pixels: ArrayBuffer;
};

type RenderRequest = {
    type: "render";
    id: number;
    settings: ColorSettings;
    maxEdge: number;
};

type PreviewRequest = InitializeRequest | RenderRequest;

type PreviewResponse = { type: "rendered"; id: number; ok: true; width: number; height: number; pixels: ArrayBuffer } | { type: "rendered"; id: number; ok: false; error: string };

const scope = globalThis as typeof globalThis & {
    onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null;
    postMessage: (message: PreviewResponse, transfer?: Transferable[]) => void;
};

let sourceCanvas: OffscreenCanvas | null = null;
let sourceWidth = 0;
let sourceHeight = 0;
let initializationError = "";

scope.onmessage = (event) => {
    if (event.data.type === "initialize") {
        initialize(event.data);
        return;
    }
    void render(event.data);
};

function initialize(request: InitializeRequest) {
    try {
        sourceWidth = request.width;
        sourceHeight = request.height;
        sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
        const context = sourceCanvas.getContext("2d", { alpha: true });
        if (!context) throw new Error("无法创建后台预览画布");
        context.putImageData(new ImageData(new Uint8ClampedArray(request.pixels), sourceWidth, sourceHeight), 0, 0);
        initializationError = "";
    } catch (error) {
        sourceCanvas = null;
        initializationError = error instanceof Error ? error.message : "后台预览初始化失败";
    }
}

async function render(request: RenderRequest) {
    try {
        if (!sourceCanvas || !sourceWidth || !sourceHeight) throw new Error(initializationError || "后台预览尚未初始化");
        const dimensions = fitDimensions(sourceWidth, sourceHeight, request.maxEdge);
        const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
        const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
        if (!context) throw new Error("无法创建后台预览画布");
        context.drawImage(sourceCanvas, 0, 0, dimensions.width, dimensions.height);
        const imageData = context.getImageData(0, 0, dimensions.width, dimensions.height);
        const lut = await loadFilmLut(request.settings.lutId);
        applyColorSettingsToImageData(imageData, dimensions.width, dimensions.height, request.settings, 0, 0, dimensions.width, dimensions.height, lut);
        const pixels = imageData.data.buffer;
        scope.postMessage({ type: "rendered", id: request.id, ok: true, width: dimensions.width, height: dimensions.height, pixels }, [pixels]);
    } catch (error) {
        scope.postMessage({ type: "rendered", id: request.id, ok: false, error: error instanceof Error ? error.message : "后台预览失败" });
    }
}

function fitDimensions(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

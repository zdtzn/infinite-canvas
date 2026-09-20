import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const CANVAS_THUMBNAIL_MAX_EDGE = 1280;

type CanvasImageLoadingAttributes = {
    loading: "eager" | "lazy";
    fetchPriority: "high" | "auto";
};

export function canvasImageDisplaySource(
    metadata: Pick<CanvasNodeMetadata, "content" | "thumbnailUrl"> | undefined,
    display: { width: number; height: number; scale: number; pixelRatio: number; thumbnailMaxEdge?: number },
) {
    if (!metadata) return "";
    const requiredEdge = Math.max(display.width, display.height) * display.scale * display.pixelRatio;
    // Legacy and generated previews default to 512px; loaded dimensions override this.
    const previewEdge = display.thumbnailMaxEdge ?? 512;
    const usePreview = Number.isFinite(requiredEdge) && requiredEdge > 0 && requiredEdge <= previewEdge;
    return (usePreview ? metadata.thumbnailUrl || metadata.content : metadata.content || metadata.thumbnailUrl) || "";
}

export function canvasImageLoadingAttributes(selected: boolean): CanvasImageLoadingAttributes {
    return selected ? { loading: "eager", fetchPriority: "high" } : { loading: "lazy", fetchPriority: "auto" };
}

export function needsCanvasImageThumbnail(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content || !node.metadata.storageKey || node.metadata.thumbnailKey) return false;
    const longestEdge = Math.max(Number(node.metadata.naturalWidth) || 0, Number(node.metadata.naturalHeight) || 0);
    return !longestEdge || longestEdge > CANVAS_THUMBNAIL_MAX_EDGE;
}

import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const CANVAS_THUMBNAIL_MAX_EDGE = 1280;

type CanvasImageLoadingAttributes = {
    loading: "eager" | "lazy";
    fetchPriority: "high" | "low";
};

export function canvasImageDisplaySource(metadata: Pick<CanvasNodeMetadata, "content" | "thumbnailUrl"> | undefined, selected: boolean) {
    if (!metadata) return "";
    return (selected ? metadata.content : metadata.thumbnailUrl || metadata.content) || "";
}

export function canvasImageLoadingAttributes(selected: boolean): CanvasImageLoadingAttributes {
    return selected ? { loading: "eager", fetchPriority: "high" } : { loading: "lazy", fetchPriority: "low" };
}

export function needsCanvasImageThumbnail(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content || !node.metadata.storageKey || node.metadata.thumbnailKey) return false;
    const longestEdge = Math.max(Number(node.metadata.naturalWidth) || 0, Number(node.metadata.naturalHeight) || 0);
    return !longestEdge || longestEdge > CANVAS_THUMBNAIL_MAX_EDGE;
}

import { describe, expect, test } from "bun:test";

import { canvasImageDisplaySource, canvasImageLoadingAttributes, needsCanvasImageThumbnail } from "./canvas-image-loading";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas image loading", () => {
    const metadata = {
        content: "/api/assets/image%3Aoriginal?v=100",
        thumbnailUrl: "/api/assets/image%3Athumbnail?v=200",
    };
    const display = { width: 320, height: 240, scale: 1, pixelRatio: 1 };

    test("uses the lightweight thumbnail for an idle canvas node", () => {
        expect(canvasImageDisplaySource(metadata, display)).toBe(metadata.thumbnailUrl);
        expect(canvasImageLoadingAttributes(false)).toEqual({ loading: "lazy", fetchPriority: "auto" });
    });

    test("uses original pixels at high zoom or device pixel ratio, independent of selection", () => {
        expect(canvasImageDisplaySource(metadata, { ...display, scale: 2 })).toBe(metadata.content);
        expect(canvasImageDisplaySource(metadata, { ...display, pixelRatio: 2 })).toBe(metadata.content);
        expect(canvasImageLoadingAttributes(true)).toEqual({ loading: "eager", fetchPriority: "high" });
    });

    test("respects actual preview size and exact pixel boundary", () => {
        expect(canvasImageDisplaySource(metadata, { ...display, thumbnailMaxEdge: 128 })).toBe(metadata.content);
        expect(canvasImageDisplaySource(metadata, { ...display, scale: 2, thumbnailMaxEdge: 1280 })).toBe(metadata.thumbnailUrl);
        expect(canvasImageDisplaySource(metadata, { ...display, width: 512 })).toBe(metadata.thumbnailUrl);
        expect(canvasImageDisplaySource(metadata, { ...display, width: 513 })).toBe(metadata.content);
        expect(canvasImageDisplaySource(metadata, { ...display, scale: NaN })).toBe(metadata.content);
        expect(canvasImageDisplaySource(undefined, display)).toBe("");
    });

    test("falls back to the original when no thumbnail exists", () => {
        expect(canvasImageDisplaySource({ content: metadata.content }, display)).toBe(metadata.content);
    });

    test("backfills only stored canvas images that do not have a thumbnail", () => {
        const node: CanvasNodeData = {
            id: "image-1",
            type: CanvasNodeType.Image,
            title: "Image",
            position: { x: 0, y: 0 },
            width: 320,
            height: 320,
            metadata: { content: metadata.content, storageKey: "image:original", naturalWidth: 4096, naturalHeight: 4096 },
        };

        expect(needsCanvasImageThumbnail(node)).toBe(true);
        expect(needsCanvasImageThumbnail({ ...node, metadata: { ...node.metadata, thumbnailKey: "image:thumbnail" } })).toBe(false);
        expect(needsCanvasImageThumbnail({ ...node, type: CanvasNodeType.Text })).toBe(false);
        expect(needsCanvasImageThumbnail({ ...node, metadata: { ...node.metadata, naturalWidth: 1024, naturalHeight: 768 } })).toBe(false);
    });
});

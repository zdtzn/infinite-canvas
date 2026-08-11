import { describe, expect, test } from "bun:test";

import { canvasImageDisplaySource, canvasImageLoadingAttributes, needsCanvasImageThumbnail } from "./canvas-image-loading";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas image loading", () => {
    const metadata = {
        content: "/api/assets/image%3Aoriginal?v=100",
        thumbnailUrl: "/api/assets/image%3Athumbnail?v=200",
    };

    test("uses the lightweight thumbnail for an idle canvas node", () => {
        expect(canvasImageDisplaySource(metadata, false)).toBe(metadata.thumbnailUrl);
        expect(canvasImageLoadingAttributes(false)).toEqual({ loading: "lazy", fetchPriority: "low" });
    });

    test("loads the original image when the canvas node is selected", () => {
        expect(canvasImageDisplaySource(metadata, true)).toBe(metadata.content);
        expect(canvasImageLoadingAttributes(true)).toEqual({ loading: "eager", fetchPriority: "high" });
    });

    test("falls back to the original when no thumbnail exists", () => {
        expect(canvasImageDisplaySource({ content: metadata.content }, false)).toBe(metadata.content);
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

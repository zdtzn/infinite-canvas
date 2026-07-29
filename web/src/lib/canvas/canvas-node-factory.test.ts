import { describe, expect, test } from "bun:test";

import { createPendingImageUploadNode } from "./canvas-node-factory";

describe("canvas image upload nodes", () => {
    test("renders a local preview before durable storage finishes", () => {
        const node = createPendingImageUploadNode({ name: "portrait.jpg", size: 2_048, type: "image/jpeg" }, "blob:local-preview", { x: 500, y: 400 });

        expect(node.title).toBe("portrait.jpg");
        expect(node.metadata?.content).toBe("blob:local-preview");
        expect(node.metadata?.uploading).toBe(true);
        expect(node.metadata?.status).toBe("success");
        expect(node.metadata?.bytes).toBe(2_048);
        expect(node.metadata?.mimeType).toBe("image/jpeg");
        expect(node.position.x + node.width / 2).toBe(500);
        expect(node.position.y + node.height / 2).toBe(400);
    });
});

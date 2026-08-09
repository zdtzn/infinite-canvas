import { describe, expect, test } from "bun:test";

import { assetCardImageUrl, assetOriginalImageUrl } from "./asset-image";

describe("asset image presentation", () => {
    const imageAsset = {
        kind: "image" as const,
        coverUrl: "/api/assets/image-original",
        data: {
            dataUrl: "/api/assets/image-original",
            thumbnailUrl: "/api/assets/image-thumbnail",
        },
    };

    test("uses the lightweight thumbnail in the asset grid", () => {
        expect(assetCardImageUrl(imageAsset)).toBe("/api/assets/image-thumbnail");
    });

    test("keeps the original image for preview and download", () => {
        expect(assetOriginalImageUrl(imageAsset)).toBe("/api/assets/image-original");
    });
});

import { describe, expect, test } from "bun:test";

import { assetCardImageUrl, assetNeedsThumbnail, assetOriginalImageUrl } from "./asset-image";

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

    test("identifies stored images that still need a lightweight thumbnail", () => {
        expect(
            assetNeedsThumbnail({
                kind: "image",
                data: { storageKey: "image:original", dataUrl: "/api/assets/image-original" },
            }),
        ).toBe(true);
        expect(
            assetNeedsThumbnail({
                kind: "image",
                data: { storageKey: "image:original", thumbnailKey: "image:thumbnail" },
            }),
        ).toBe(false);
        expect(assetNeedsThumbnail({ kind: "text", data: { content: "prompt" } })).toBe(false);
    });
});

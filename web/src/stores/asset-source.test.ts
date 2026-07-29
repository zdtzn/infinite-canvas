import { describe, expect, test } from "bun:test";

import { IMAGE_WORKBENCH_ASSET_SOURCE, normalizeAssetSource } from "./asset-source";

describe("asset source naming", () => {
    test("maps the legacy image workbench name to the current product name", () => {
        expect(normalizeAssetSource("生图工作台")).toBe(IMAGE_WORKBENCH_ASSET_SOURCE);
    });

    test("preserves unrelated and missing source values", () => {
        expect(normalizeAssetSource("手动添加")).toBe("手动添加");
        expect(normalizeAssetSource(undefined)).toBeUndefined();
    });
});

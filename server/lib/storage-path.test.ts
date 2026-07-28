import { expect, test } from "bun:test";

import {
  assetCacheControl,
  assetStorageFilename,
  legacyAssetStorageFilename,
  nextAssetVersion,
} from "./storage-path";

test("asset filenames remain stable without legacy sanitization collisions", () => {
  expect(legacyAssetStorageFilename("image:item")).toBe(
    legacyAssetStorageFilename("image_item"),
  );
  expect(assetStorageFilename("image:item")).not.toBe(
    assetStorageFilename("image_item"),
  );
  expect(assetStorageFilename("image:item")).toBe(
    assetStorageFilename("image:item"),
  );
});

test("asset versions remain monotonic and only matching URLs are immutable", () => {
  expect(nextAssetVersion(1_000, 999)).toBe(1_001);
  expect(nextAssetVersion(1_000, 2_000)).toBe(2_000);
  expect(assetCacheControl("https://canvas.example/api/assets/image?v=1001", 1_001)).toContain(
    "immutable",
  );
  expect(assetCacheControl("https://canvas.example/api/assets/image?v=1000", 1_001)).toContain(
    "must-revalidate",
  );
});

import { describe, expect, test } from "bun:test";

import { AssetLibraryInputError, normalizeAssetLibrary, normalizeAssetLibraryItem } from "./asset-library";
import type { StoredAsset } from "../types";

const image: StoredAsset = {
  key: "image:mine",
  userId: "user-a",
  mimeType: "image/png",
  bytes: 123,
  createdAt: 1,
};

const thumbnail: StoredAsset = {
  key: "image:thumb:mine",
  userId: "user-a",
  mimeType: "image/webp",
  bytes: 45,
  createdAt: 2,
};

describe("asset library validation", () => {
  test("normalizes user-owned image metadata without persisting browser URLs", () => {
    const item = normalizeAssetLibraryItem(
      {
        id: "asset-one",
        kind: "image",
        title: "Example",
        coverUrl: "blob:browser-only",
        data: {
          dataUrl: "blob:browser-only",
          storageKey: image.key,
          thumbnailKey: thumbnail.key,
          width: 800,
          height: 600,
          bytes: 999,
          mimeType: "image/jpeg",
        },
      },
      "asset-one",
      (key) => (key === image.key ? image : key === thumbnail.key ? thumbnail : undefined),
    );

    expect(item.payload).toMatchObject({
      id: "asset-one",
      kind: "image",
      coverUrl: "",
      data: {
        dataUrl: "",
        storageKey: "image:mine",
        thumbnailKey: "image:thumb:mine",
        width: 800,
        height: 600,
        bytes: 123,
        mimeType: "image/png",
      },
    });
  });

  test("rejects image thumbnails that do not belong to the current user", () => {
    expect(() =>
      normalizeAssetLibraryItem(
        {
          id: "asset-one",
          kind: "image",
          data: {
            storageKey: image.key,
            thumbnailKey: "image:thumb:foreign",
          },
        },
        undefined,
        (key) => (key === image.key ? image : undefined),
      ),
    ).toThrow(AssetLibraryInputError);
  });

  test("rejects media records that reference another user's file", () => {
    expect(() =>
      normalizeAssetLibraryItem(
        {
          id: "asset-one",
          kind: "image",
          data: { storageKey: "image:not-mine" },
        },
        undefined,
        () => undefined,
      ),
    ).toThrow(AssetLibraryInputError);
  });

  test("keeps text assets independent from binary storage", () => {
    const items = normalizeAssetLibrary(
      [
        {
          id: "prompt-one",
          kind: "text",
          title: "Prompt",
          coverUrl: "https://example.com/cover.png",
          data: { content: "A useful prompt" },
        },
      ],
      () => undefined,
    );

    expect(items[0].payload).toMatchObject({
      kind: "text",
      coverUrl: "https://example.com/cover.png",
      data: { content: "A useful prompt" },
    });
  });
});

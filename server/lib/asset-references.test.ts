import { describe, expect, test } from "bun:test";

import {
  assetReferenceId,
  collectAssetStorageKeys,
  collectReferencedAssetIds,
  garbageCollectableAssets,
} from "./asset-references";

describe("asset references", () => {
  test("collects nested media and thumbnail references without treating prose as a reference", () => {
    const cyclic: Record<string, unknown> = {
      nodes: [
        { metadata: { storageKey: "image:canvas-one" } },
        { metadata: { thumbnailKey: "image:canvas-one-thumb" } },
      ],
      prompt: "mention image:not-a-reference in prose",
      invalid: { storageKey: "../outside" },
    };
    cyclic.self = cyclic;

    expect(Array.from(collectAssetStorageKeys(cyclic)).sort()).toEqual([
      "image:canvas-one",
      "image:canvas-one-thumb",
    ]);
  });

  test("keeps references scoped to the owning user and includes the avatar", () => {
    const referenced = collectReferencedAssetIds(
      "user-a",
      [
        { data: { storageKey: "image:library" } },
        { images: [{ storageKey: "image:history" }] },
      ],
      "image:avatar",
    );

    expect(referenced).toEqual(
      new Set([
        assetReferenceId("user-a", "image:library"),
        assetReferenceId("user-a", "image:history"),
        assetReferenceId("user-a", "image:avatar"),
      ]),
    );
    expect(referenced.has(assetReferenceId("user-b", "image:library"))).toBe(
      false,
    );
  });

  test("only returns old assets that have no live reference", () => {
    const now = 1_000_000;
    const graceMs = 100_000;
    const assets = [
      { userId: "user-a", key: "image:kept", createdAt: 1 },
      { userId: "user-a", key: "image:orphan", createdAt: 1 },
      { userId: "user-a", key: "image:new", createdAt: now - graceMs + 1 },
    ];
    const referenced = new Set([
      assetReferenceId("user-a", "image:kept"),
    ]);

    expect(
      garbageCollectableAssets(assets, referenced, now, graceMs).map(
        (asset) => asset.key,
      ),
    ).toEqual(["image:orphan"]);
  });
});

import { describe, expect, test } from "bun:test";

import {
  GenerationHistoryInputError,
  normalizeGenerationHistoryItem,
} from "./generation-history";
import type { StoredAsset } from "../types";

const ownedImage: StoredAsset = {
  key: "image:owned",
  userId: "user-a",
  mimeType: "image/png",
  bytes: 123,
  createdAt: 1,
};

describe("generation history validation", () => {
  test("keeps safe metadata and strips browser-only ownership and URLs", () => {
    const item = normalizeGenerationHistoryItem(
      "image",
      {
        id: "history-one",
        ownerUserId: "must-not-be-persisted",
        createdAt: 10,
        updatedAt: 20,
        prompt: "A mountain",
        images: [
          {
            id: "image-one",
            dataUrl: "blob:browser-only",
            storageKey: ownedImage.key,
            width: 800,
            height: 600,
            bytes: 999,
            mimeType: "image/jpeg",
          },
        ],
      },
      "history-one",
      (key) => (key === ownedImage.key ? ownedImage : undefined),
    );

    expect(item).toMatchObject({
      id: "history-one",
      kind: "image",
      createdAt: 10,
      updatedAt: 20,
      payload: {
        id: "history-one",
        createdAt: 10,
        updatedAt: 20,
        prompt: "A mountain",
        images: [
          {
            id: "image-one",
            dataUrl: "",
            storageKey: "image:owned",
            bytes: 123,
            mimeType: "image/png",
          },
        ],
      },
    });
    expect(item.payload).not.toHaveProperty("ownerUserId");
  });

  test("rejects history that references another user's media", () => {
    expect(() =>
      normalizeGenerationHistoryItem(
        "image",
        {
          id: "history-one",
          createdAt: 10,
          images: [{ id: "image-one", storageKey: "image:foreign" }],
        },
        undefined,
        () => undefined,
      ),
    ).toThrow(GenerationHistoryInputError);
  });
});

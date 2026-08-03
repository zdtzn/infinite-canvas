import { describe, expect, test } from "bun:test";

import {
  ImageJobReferenceInputError,
  parseClientImageJobReference,
} from "./image-job-reference";

describe("image job reference input", () => {
  test("accepts inline data and compact server asset handles", () => {
    expect(parseClientImageJobReference("data:image/png;base64,AA==")).toEqual({
      kind: "data",
      dataUrl: "data:image/png;base64,AA==",
    });
    expect(
      parseClientImageJobReference({ assetKey: "image:reference-1" }),
    ).toEqual({ kind: "asset", assetKey: "image:reference-1" });
  });

  test("rejects paths, other asset kinds, and malformed handles", () => {
    expect(() =>
      parseClientImageJobReference({ assetKey: "../other-user/image" }),
    ).toThrow(ImageJobReferenceInputError);
    expect(() =>
      parseClientImageJobReference({ assetKey: "file:reference" }),
    ).toThrow(ImageJobReferenceInputError);
    expect(() =>
      parseClientImageJobReference({ path: "/data/assets/other-user" }),
    ).toThrow(ImageJobReferenceInputError);
    expect(() => parseClientImageJobReference(null)).toThrow(
      ImageJobReferenceInputError,
    );
  });
});

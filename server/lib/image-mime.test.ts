import { expect, test } from "bun:test";

import { resolveImageMimeType } from "./image-mime";

test("detects a PNG sent as application/octet-stream", async () => {
  const file = new Blob(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    { type: "application/octet-stream" },
  );

  expect(await resolveImageMimeType(file)).toBe("image/png");
});

test("leaves an unrecognized generic file as non-image", async () => {
  const file = new Blob(["not an image"], { type: "application/octet-stream" });

  expect(await resolveImageMimeType(file)).toBe("application/octet-stream");
});

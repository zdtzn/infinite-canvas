import { expect, test } from "bun:test";

import { decodeImageDataUrl, resolveImageMimeType } from "./image-mime";

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

test("does not trust an SVG image declaration", async () => {
  const file = new Blob(["<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"], {
    type: "image/svg+xml",
  });

  expect(await resolveImageMimeType(file)).toBe("application/octet-stream");
  expect(() => decodeImageDataUrl(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`)).toThrow("参考图格式无效");
});

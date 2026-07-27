import { expect, test } from "bun:test";

import { decodeImageDataUrl, readImageDimensions, resolveImageMimeType } from "./image-mime";

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

test("reads PNG, JPEG, WebP and AVIF dimensions without decoding pixels", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  png.set([0x00, 0x00, 0x06, 0x40, 0x00, 0x00, 0x03, 0x84], 16);

  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x84, 0x06, 0x40, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);

  const webp = new Uint8Array(30);
  webp.set(Buffer.from("RIFF"), 0);
  webp.set([0x16, 0x00, 0x00, 0x00], 4);
  webp.set(Buffer.from("WEBPVP8X"), 8);
  webp.set([0x0a, 0x00, 0x00, 0x00], 16);
  webp.set([0x3f, 0x06, 0x00, 0x83, 0x03, 0x00], 24);

  const avif = new Uint8Array(44);
  avif.set([0x00, 0x00, 0x00, 0x18], 0);
  avif.set(Buffer.from("ftypavif"), 4);
  avif.set([0x00, 0x00, 0x00, 0x14], 24);
  avif.set(Buffer.from("ispe"), 28);
  avif.set([0x00, 0x00, 0x06, 0x40, 0x00, 0x00, 0x03, 0x84], 36);

  expect(readImageDimensions(png)).toEqual({ width: 1600, height: 900 });
  expect(readImageDimensions(jpeg)).toEqual({ width: 1600, height: 900 });
  expect(readImageDimensions(webp)).toEqual({ width: 1600, height: 900 });
  expect(readImageDimensions(avif, "image/avif")).toEqual({ width: 1600, height: 900 });
  expect(readImageDimensions(Uint8Array.from([0x00, 0x01]))).toBeNull();
});

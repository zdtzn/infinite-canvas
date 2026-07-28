import { expect, test } from "bun:test";

import { resolveMediaMimeType } from "./media-mime";

test("detects MP4 video without trusting the declared MIME type", async () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set(Buffer.from("ftypisom"), 4);
  const file = new Blob([bytes], { type: "application/octet-stream" });

  expect(await resolveMediaMimeType(file, "video")).toBe("video/mp4");
});

test("rejects a script disguised as audio or video", async () => {
  const payload = new Blob(["<script>alert(1)</script>"], {
    type: "video/mp4",
  });

  expect(await resolveMediaMimeType(payload, "video")).toBe(
    "application/octet-stream",
  );
  expect(await resolveMediaMimeType(payload, "audio")).toBe(
    "application/octet-stream",
  );
});

test("detects common audio containers from signatures", async () => {
  const wav = new Uint8Array(16);
  wav.set(Buffer.from("RIFF"), 0);
  wav.set(Buffer.from("WAVE"), 8);
  const mp3 = new Blob([Buffer.from("ID3example")], { type: "audio/mpeg" });

  expect(
    await resolveMediaMimeType(new Blob([wav], { type: "video/mp4" }), "audio"),
  ).toBe("audio/wav");
  expect(await resolveMediaMimeType(mp3, "audio")).toBe("audio/mpeg");
});

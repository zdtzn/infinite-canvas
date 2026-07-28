export type MediaKind = "audio" | "video";

export const ALLOWED_AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac", "audio/flac"]);
export const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export async function resolveMediaMimeType(file: Blob, kind: MediaKind) {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const declared = String(file.type || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const detected = detectMediaMimeFromBytes(bytes, kind, declared);
  return isAllowedMediaMimeType(detected, kind) ? detected : "application/octet-stream";
}

export function isAllowedMediaMimeType(value: string, kind: MediaKind) {
  return (kind === "audio" ? ALLOWED_AUDIO_MIME_TYPES : ALLOWED_VIDEO_MIME_TYPES).has(
    value.toLowerCase(),
  );
}

export function detectMediaMimeFromBytes(
  bytes: Uint8Array,
  kind: MediaKind,
  declared = "",
) {
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.max(0, bytes.length - 8)).toLowerCase();
    if (kind === "audio") return "audio/mp4";
    return brands.includes("qt  ") ? "video/quicktime" : "video/mp4";
  }
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
    return kind === "audio" ? "audio/webm" : "video/webm";
  if (ascii(bytes, 0, 4) === "OggS")
    return kind === "audio" ? "audio/ogg" : "";
  if (
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WAVE"
  )
    return kind === "audio" ? "audio/wav" : "";
  if (ascii(bytes, 0, 4) === "fLaC")
    return kind === "audio" ? "audio/flac" : "";
  if (
    kind === "audio" &&
    (ascii(bytes, 0, 3) === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] || 0) >= 0xe0))
  )
    return declared === "audio/aac" ? "audio/aac" : "audio/mpeg";
  return "";
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

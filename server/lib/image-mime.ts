const IMAGE_MIME_FALLBACK = "application/octet-stream";

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

export const MAX_REFERENCE_IMAGE_BYTES = 16 * 1024 * 1024;

export async function resolveImageMimeType(file: Blob) {
  return (await detectImageMimeType(file)) || IMAGE_MIME_FALLBACK;
}

export async function detectImageMimeType(file: Blob) {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    matches(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return "image/webp";

  // AVIF uses the ISO base media container. Its compatible brands appear after the ftyp box header.
  if (matches(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brands = new TextDecoder().decode(bytes.slice(8));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }

  return "";
}

export function isAllowedImageMimeType(value: string) {
  return ALLOWED_IMAGE_MIME_TYPES.has(value.toLowerCase());
}

export function decodeImageDataUrl(value: string, maxBytes = MAX_REFERENCE_IMAGE_BYTES) {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=_-]+)$/i);
  if (!match) throw new Error("图片数据格式无效");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.byteLength) throw new Error("图片数据为空");
  if (bytes.byteLength > maxBytes) throw new Error("单张参考图不能超过 16 MB");
  const mimeType = detectImageMimeFromBytes(bytes);
  if (!isAllowedImageMimeType(mimeType)) throw new Error("参考图格式无效，仅支持 PNG、JPEG、WebP 或 AVIF");
  return { bytes, mimeType, base64: bytes.toString("base64") };
}

export function detectImageMimeFromBytes(bytes: Uint8Array) {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (matches(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brands = new TextDecoder().decode(bytes.slice(8));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  return "";
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

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

export function readImageDimensions(bytes: Uint8Array, mimeType = detectImageMimeFromBytes(bytes)) {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  if (mimeType === "image/webp") return readWebpDimensions(bytes);
  if (mimeType === "image/avif") return readAvifDimensions(bytes);
  return null;
}

function readPngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || !matches(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return null;
  return validDimensions(readUint32Be(bytes, 16), readUint32Be(bytes, 20));
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || !matches(bytes, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = readUint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return validDimensions(readUint16Be(bytes, offset + 5), readUint16Be(bytes, offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array) {
  if (bytes.length < 20 || !matches(bytes, [0x52, 0x49, 0x46, 0x46]) || !matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.length) break;
    if (chunkType === "VP8X" && chunkSize >= 10) {
      return validDimensions(readUint24Le(bytes, dataOffset + 4) + 1, readUint24Le(bytes, dataOffset + 7) + 1);
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      const bits = readUint32Le(bytes, dataOffset + 1);
      return validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunkType === "VP8 " && chunkSize >= 10 && matches(bytes, [0x9d, 0x01, 0x2a], dataOffset + 3)) {
      return validDimensions(readUint16Le(bytes, dataOffset + 6) & 0x3fff, readUint16Le(bytes, dataOffset + 8) & 0x3fff);
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function readAvifDimensions(bytes: Uint8Array) {
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (!matches(bytes, [0x69, 0x73, 0x70, 0x65], offset)) continue;
    const boxSize = readUint32Be(bytes, offset - 4);
    if (boxSize < 20 || offset - 4 + boxSize > bytes.length) continue;
    const dimensions = validDimensions(readUint32Be(bytes, offset + 8), readUint32Be(bytes, offset + 12));
    if (dimensions) return dimensions;
  }
  return null;
}

function isJpegStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function validDimensions(width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) | ((bytes[offset + 2] || 0) << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  return (((bytes[offset] || 0) * 0x1000000 + ((bytes[offset + 1] || 0) << 16) + ((bytes[offset + 2] || 0) << 8) + (bytes[offset + 3] || 0)) >>> 0);
}

function readUint32Le(bytes: Uint8Array, offset: number) {
  return (((bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8) + ((bytes[offset + 2] || 0) << 16) + (bytes[offset + 3] || 0) * 0x1000000) >>> 0);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

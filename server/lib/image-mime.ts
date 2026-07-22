const IMAGE_MIME_FALLBACK = "application/octet-stream";

export async function resolveImageMimeType(file: Blob) {
  const declaredMimeType = String(file.type || "")
    .trim()
    .toLowerCase();
  if (declaredMimeType.startsWith("image/")) return declaredMimeType;
  return (
    (await detectImageMimeType(file)) || declaredMimeType || IMAGE_MIME_FALLBACK
  );
}

export async function detectImageMimeType(file: Blob) {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  )
    return "image/gif";
  if (
    matches(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return "image/webp";
  if (matches(bytes, [0x42, 0x4d])) return "image/bmp";
  if (
    matches(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    matches(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  )
    return "image/tiff";

  // AVIF uses the ISO base media container. Its compatible brands appear after the ftyp box header.
  if (matches(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brands = new TextDecoder().decode(bytes.slice(8));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }

  return "";
}

function matches(bytes: Uint8Array, expected: number[], offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

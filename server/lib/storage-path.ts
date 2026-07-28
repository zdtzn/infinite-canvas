import { createHash } from "node:crypto";

export function assetStorageFilename(key: string) {
  const slug =
    key
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120) || "asset";
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `${slug}--${digest}`;
}

export function legacyAssetStorageFilename(key: string) {
  return key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

export function nextAssetVersion(previous: number | undefined, now = Date.now()) {
  return Math.max(now, Math.max(0, Number(previous) || 0) + 1);
}

export function assetCacheControl(requestUrl: string, createdAt: number) {
  try {
    if (new URL(requestUrl).searchParams.get("v") === String(createdAt))
      return "private, max-age=31536000, immutable";
  } catch {
    // Invalid request URLs are handled by the router; use conservative caching here.
  }
  return "private, max-age=0, must-revalidate";
}

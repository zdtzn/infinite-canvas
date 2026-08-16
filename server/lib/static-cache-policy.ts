const VERSIONED_CUTOUT_ASSET =
  /\/background-removal\/\d+\.\d+\.\d+\/(?!resources\.json$).+/;
const CUTOUT_RESOURCE_MANIFEST =
  /\/background-removal\/\d+\.\d+\.\d+\/resources\.json$/;
const HASHED_FRONTEND_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|svg)$/;

export function staticCacheControl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (CUTOUT_RESOURCE_MANIFEST.test(normalized)) return "no-cache";
  if (
    VERSIONED_CUTOUT_ASSET.test(normalized) ||
    HASHED_FRONTEND_ASSET.test(normalized)
  )
    return "public, max-age=31536000, immutable";
  if (normalized.endsWith("index.html") || normalized.endsWith("theme-init.js"))
    return "no-cache";
  return "public, max-age=3600";
}

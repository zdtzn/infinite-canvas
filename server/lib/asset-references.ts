const ASSET_STORAGE_KEY_PATTERN = /^(?:image|video|audio|file|video-reference|audio-reference):[A-Za-z0-9._:-]{1,180}$/;
const ASSET_REFERENCE_PROPERTIES = new Set(["storageKey", "thumbnailKey"]);

export type AssetReferenceRecord = {
  userId: string;
  key: string;
  createdAt: number;
};

export function assetReferenceId(userId: string, storageKey: string) {
  return `${userId}\0${storageKey}`;
}

export function collectAssetStorageKeys(value: unknown) {
  const keys = new Set<string>();
  const stack: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [property, item] of Object.entries(
      current as Record<string, unknown>,
    )) {
      if (
        ASSET_REFERENCE_PROPERTIES.has(property) &&
        typeof item === "string" &&
        ASSET_STORAGE_KEY_PATTERN.test(item)
      ) {
        keys.add(item);
      }
      stack.push(item);
    }
  }

  return keys;
}

export function collectReferencedAssetIds(
  userId: string,
  roots: Iterable<unknown>,
  avatarKey?: string,
) {
  const referenced = new Set<string>();
  for (const root of roots) {
    for (const key of collectAssetStorageKeys(root))
      referenced.add(assetReferenceId(userId, key));
  }
  if (avatarKey) referenced.add(assetReferenceId(userId, avatarKey));
  return referenced;
}

export function garbageCollectableAssets<T extends AssetReferenceRecord>(
  assets: Iterable<T>,
  referencedAssetIds: ReadonlySet<string>,
  now: number,
  graceMs: number,
) {
  const cutoff = now - Math.max(0, graceMs);
  return Array.from(assets).filter(
    (asset) =>
      Number(asset.createdAt) <= cutoff &&
      !referencedAssetIds.has(assetReferenceId(asset.userId, asset.key)),
  );
}

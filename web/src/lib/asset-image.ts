type AssetImageView = {
    kind: string;
    coverUrl?: string;
    data?: unknown;
};

function imageData(asset: AssetImageView) {
    if (!asset.data || typeof asset.data !== "object") return undefined;
    return asset.data as { dataUrl?: string; storageKey?: string; thumbnailKey?: string; thumbnailUrl?: string };
}

export function assetCardImageUrl(asset: AssetImageView) {
    const data = imageData(asset);
    if (asset.kind === "image") return data?.thumbnailUrl || asset.coverUrl || data?.dataUrl || "";
    return asset.coverUrl || "";
}

export function assetOriginalImageUrl(asset: AssetImageView) {
    const data = imageData(asset);
    if (asset.kind === "image") return data?.dataUrl || asset.coverUrl || "";
    return asset.coverUrl || "";
}

export function assetNeedsThumbnail(asset: AssetImageView) {
    const data = imageData(asset);
    return asset.kind === "image" && Boolean(data?.storageKey) && !data?.thumbnailKey;
}

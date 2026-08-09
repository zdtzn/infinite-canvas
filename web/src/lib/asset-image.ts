type AssetImageView = {
    kind: string;
    coverUrl?: string;
    data?: unknown;
};

function imageData(asset: AssetImageView) {
    if (!asset.data || typeof asset.data !== "object") return undefined;
    return asset.data as { dataUrl?: string; thumbnailUrl?: string };
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

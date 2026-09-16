import type { Asset } from "../stores/use-asset-store";

export type AssetFilters = { keyword: string; kind: string; category?: string; tags: string[] };

export function matchesAssetFilters(asset: Asset, filters: AssetFilters) {
    if (filters.kind !== "all" && filters.kind !== asset.kind) return false;
    if (filters.category !== undefined && (asset.category || "").trim() !== filters.category) return false;
    if (!filters.tags.every((tag) => (asset.tags || []).some((value) => value.toLowerCase() === tag.trim().toLowerCase()))) return false;
    const query = filters.keyword.trim().toLowerCase();
    return !query || [asset.title, asset.category || "", asset.source || "", asset.note || "", ...(asset.tags || []), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase().includes(query);
}

export function assetFacets(assets: Asset[]) {
    return {
        categories: [...new Set(assets.map((asset) => (asset.category || "").trim()).filter(Boolean))].sort(),
        tags: [...new Set(assets.flatMap((asset) => asset.tags || []))].sort(),
        total: assets.length,
        uncategorized: assets.filter((asset) => !asset.category?.trim()).length,
    };
}

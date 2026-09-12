export const IMAGE_WORKBENCH_ASSET_SOURCE = "丹青台";

export function normalizeAssetSource(source?: string) {
    return source === "生图工作台" ? IMAGE_WORKBENCH_ASSET_SOURCE : source;
}

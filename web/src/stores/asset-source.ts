export const IMAGE_WORKBENCH_ASSET_SOURCE = "丹青台";
export const PRODUCT_LAB_ASSET_SOURCE = "商品幻境";

export function normalizeAssetSource(source?: string) {
    return source === "生图工作台" ? IMAGE_WORKBENCH_ASSET_SOURCE : source;
}

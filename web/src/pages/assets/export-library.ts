import type { Asset } from "@/stores/use-asset-store";
import type { ServerAssetLibrary } from "@/services/server-api";

export async function collectExportAssets(readPage: (page: number) => Promise<ServerAssetLibrary>, assertCurrent: () => void) {
    const items = new Map<string, Asset>();
    for (let page = 1; ; page += 1) {
        assertCurrent();
        const result = await readPage(page);
        assertCurrent();
        const previousCount = items.size;
        for (const asset of result.items) items.set(asset.id, asset);
        if (!result.hasMore) return [...items.values()];
        if (items.size === previousCount) throw new Error("素材分页未推进，请刷新后重新导出");
    }
}

import { expect, test } from "bun:test";
import { collectExportAssets } from "./export-library";
import type { Asset } from "@/stores/use-asset-store";

test("exports all cloud pages, not just the sixty cached assets", async () => {
    const pages: number[] = [];
    const result = await collectExportAssets(async (page) => {
        pages.push(page);
        return { initialized: true, hasMore: page < 3, items: Array.from({ length: page === 3 ? 5 : 60 }, (_, i) => ({ id: `${page}-${i}` }) as Asset) };
    }, () => {});
    expect(result).toHaveLength(125);
    expect(pages).toEqual([1, 2, 3]);
});
test("refuses stalled pagination rather than silently exporting an incomplete library", async () => {
    await expect(collectExportAssets(async () => ({ initialized: true, hasMore: true, items: [{ id: "same" } as Asset] }), () => {})).rejects.toThrow("分页未推进");
});
test("aborts if the account changes during a page read", async () => {
    let current = true;
    await expect(collectExportAssets(async () => { current = false; return { initialized: true, items: [] }; }, () => { if (!current) throw new Error("账号已切换"); })).rejects.toThrow("账号已切换");
});

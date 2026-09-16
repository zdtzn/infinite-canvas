import { expect, test } from "bun:test";
import { assetFacets, matchesAssetFilters } from "./asset-filters";
import type { Asset } from "../stores/use-asset-store";
const old: Asset = { id: "old", title: "海报", kind: "text", coverUrl: "", tags: ["角色", "金色"], data: { content: "欢迎" }, createdAt: "", updatedAt: "" };
test("asset filters combine category and all tags without excluding legacy uncategorized assets", () => {
    expect(matchesAssetFilters(old, { keyword: "", kind: "all", category: "", tags: ["角色", "金色"] })).toBe(true);
    expect(matchesAssetFilters(old, { keyword: "", kind: "all", category: "产品", tags: [] })).toBe(false);
    expect(matchesAssetFilters(old, { keyword: "", kind: "all", tags: ["不存在"] })).toBe(false);
    expect(matchesAssetFilters({ ...old, category: "产品" }, { keyword: "产品", kind: "text", tags: [] })).toBe(true);
    expect(matchesAssetFilters({ ...old, tags: ["Portrait"] }, { keyword: "", kind: "all", tags: ["portrait"] })).toBe(true);
});
test("asset facets are deduplicated and do not modify the records", () => {
    expect(assetFacets([old, { ...old, id: "new", category: "产品" }])).toEqual({ categories: ["产品"], tags: ["角色", "金色"], total: 2, uncategorized: 1 });
    expect(old.category).toBeUndefined();
});

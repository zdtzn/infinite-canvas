import { expect, test } from "bun:test";
import { createZip } from "@/lib/zip";
import { readAssetPackage } from "./asset-transfer";
import { mergeAssetFolders } from "../../../../shared/asset-folders";
import { useUserStore } from "@/stores/use-user-store";

test("asset package restores folder hierarchy with destination ids and preserves the original text", async () => {
    const folders = [{ id: "import-parent", name: "项目", parentId: null }, { id: "import-child", name: "参考", parentId: "import-parent" }];
    const assets = [{ id: "asset", title: "原素材", kind: "text", tags: [], folderId: "import-child", data: { content: "保持完整提示词" } }];
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", version: 1, assets, folders, files: [] }) }]);
    const result = await readAssetPackage(new File([zip], "assets.zip"), async incoming => {
        const merged = mergeAssetFolders([{ id: "existing-parent", name: "项目", parentId: null }, { id: "existing-child", name: "参考", parentId: "existing-parent" }], incoming);
        expect(merged.folders).toHaveLength(2);
        return merged.mapping;
    });
    expect(result[0]).toMatchObject({ folderId: "existing-child", title: "原素材", data: { content: "保持完整提示词" } });
    expect(assets[0].folderId).toBe("import-child");
});

test("a package without folder information imports into the root without creating orphan folder ids", async () => {
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", assets: [{ id: "legacy", kind: "text", data: { content: "保留" } }], files: [] }) }]);
    const result = await readAssetPackage(new File([zip], "assets.zip"));
    expect(result[0].folderId).toBeNull();
    expect(result[0].data).toEqual({ content: "保留" });
});

test("switching account during folder import stops before media or assets are imported", async () => {
    const before = useUserStore.getState();
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", assets: [], folders: [], files: [] }) }]);
    try {
        await expect(readAssetPackage(new File([zip], "assets.zip"), async () => {
            useUserStore.setState({ user: { ...before.user, id: "different-owner" } as NonNullable<typeof before.user> });
            return new Map();
        })).rejects.toThrow("账号已切换");
    } finally { useUserStore.setState(before); }
});

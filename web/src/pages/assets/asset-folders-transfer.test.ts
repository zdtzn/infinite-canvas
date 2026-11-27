import { expect, spyOn, test } from "bun:test";
import { createZip } from "@/lib/zip";
import { readAssetPackage } from "./asset-transfer";
import { mergeAssetFolders } from "../../../../shared/asset-folders";
import { useUserStore } from "@/stores/use-user-store";
import * as imageStorage from "@/services/image-storage";

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

test("a backup restores image bytes under a new key and drops the source browser preview", async () => {
    const save = spyOn(imageStorage, "setImageBlob").mockImplementation(async key => "/api/assets/" + key);
    try {
        const asset = { id: "image", kind: "image", coverUrl: "blob:source-thumbnail", data: { storageKey: "image:source", thumbnailKey: "image:thumbnail", thumbnailUrl: "blob:source-thumbnail", dataUrl: "blob:source-original" } };
        const zip = await createZip([
            { name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", version: 1, assets: [asset], files: [{ storageKey: "image:source", path: "files/pic.png", mimeType: "image/png", bytes: 3 }] }) },
            { name: "files/pic.png", data: new Uint8Array([5, 17, 32]) },
        ]);
        const [restored] = await readAssetPackage(new File([zip], "assets.zip"));
        expect(restored.kind).toBe("image");
        if (restored.kind !== "image") throw new Error("Expected image");
        const [key, blob] = save.mock.calls[0];
        expect(key).not.toBe(asset.data.storageKey);
        expect(restored.data.storageKey).toBe(key);
        expect(restored.data.thumbnailKey).toBeUndefined();
        expect(restored.data.thumbnailUrl).toBeUndefined();
        expect(restored.data.dataUrl).toBe("/api/assets/" + key);
        expect(restored.coverUrl).toBe(restored.data.dataUrl);
        expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([5, 17, 32]);
    } finally { save.mockRestore(); }
});

test("missing originals are rejected before importing the directory tree or any assets", async () => {
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify({
        app: "infinite-canvas", version: 1, folders: [],
        assets: [{ kind: "video", data: { storageKey: "video:missing" } }],
        files: [{ storageKey: "video:missing", path: "files/missing.webm", mimeType: "video/webm", bytes: 2 }],
    }) }]);
    let folderWrites = 0;
    await expect(readAssetPackage(new File([zip], "assets.zip"), async () => { folderWrites++; return new Map(); })).rejects.toThrow("原文件缺失");
    expect(folderWrites).toBe(0);
});

import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../db/database";
import { readAssetFolders, saveAssetFolders, assertAssetFolder, moveLibraryAsset } from "./asset-folders";
import { assetFolderOptions, mergeAssetFolders, normalizeAssetFolders } from "../../shared/asset-folders";

test("folder validation rejects cycles, missing parents, duplicate siblings and excessive depth", () => {
    for (const folders of [
        [{ id: "a", name: "A", parentId: "a" }],
        [{ id: "a", name: "A", parentId: "missing" }],
        [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }],
        [{ id: "a", name: "A", parentId: null }, { id: "b", name: "A", parentId: null }],
        [{ id: "a", name: "../A", parentId: null }],
        Array.from({ length: 13 }, (_, index) => ({ id: String(index), name: String(index), parentId: index ? String(index - 1) : null })),
    ]) expect(() => normalizeAssetFolders(folders)).toThrow();
});

test("folder package merge preserves hierarchy and merges names while remapping colliding ids", () => {
    const existing = [{ id: "a", name: "项目", parentId: null }, { id: "b", name: "旧素材", parentId: "a" }];
    const merged = mergeAssetFolders(existing, [{ id: "other", name: "项目", parentId: null }, { id: "b", name: "新素材", parentId: "other" }]);
    expect(merged.mapping.get("other")).toBe("a");
    expect(merged.mapping.get("b")).not.toBe("b");
    expect(assetFolderOptions(merged.folders).map(item => item.label)).toContain("项目 / 新素材");
    expect(existing).toHaveLength(2);
});

test("moving a cloud asset preserves recent content and cannot modify another account", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-folder-move-"));
    const database = openAppDatabase({ dataDir });
    try {
        for (const owner of ["alice", "bob"]) database.raw!.query("INSERT INTO users(user_id, display_name, created_at) VALUES (?, ?, 1)").run(owner, owner);
        saveAssetFolders(database, "alice", [{ id: "folder", name: "参考", parentId: null }], 0);
        for (const owner of ["alice", "bob"]) database.upsertAssetLibraryItem(owner, { id: "one", updatedAt: 1, payload: { id: "one", kind: "text", title: owner, data: { content: `latest edit by ${owner}` } } });

        expect(moveLibraryAsset(database, "alice", "one", "folder")).toMatchObject({ title: "alice", folderId: "folder", data: { content: "latest edit by alice" } });
        expect(() => moveLibraryAsset(database, "bob", "one", "folder")).toThrow("目标文件夹");
        expect(database.loadAssetLibrary("bob").items[0].payload.folderId).toBeUndefined();
        expect(moveLibraryAsset(database, "alice", "missing", "folder")).toBeNull();
        expect(moveLibraryAsset(database, "alice", "one", null)?.folderId).toBeNull();
    } finally {
        database.close();
        rmSync(dataDir, { recursive: true, force: true });
    }
});

test("folder updates are account isolated, revision checked and move assets atomically without deleting files", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-folders-"));
    const database = openAppDatabase({ dataDir });
    try {
        for (const user of ["alice", "bob"]) database.raw!.query("INSERT INTO users(user_id, display_name, created_at) VALUES (?, ?, 1)").run(user, user);
        const folders = [{ id: "parent", name: "项目", parentId: null }, { id: "child", name: "参考", parentId: "parent" }];
        saveAssetFolders(database, "alice", folders, 0);
        saveAssetFolders(database, "bob", folders, 0);
        for (const user of ["alice", "bob"]) database.upsertAssetLibraryItem(user, { id: "asset", updatedAt: 1, payload: { id: "asset", kind: "text", folderId: "child", title: "保留素材", tags: [], data: { content: "原文" } } });
        expect(() => saveAssetFolders(database, "alice", [], 0)).toThrow("其他页面");
        expect(readAssetFolders(database, "alice").revision).toBe(1);
        const before = database.saveUserPreference;
        database.saveUserPreference = () => { throw new Error("disk failure"); };
        expect(() => saveAssetFolders(database, "alice", folders.slice(0, 1), 1)).toThrow("disk failure");
        database.saveUserPreference = before;
        expect(database.loadAssetLibrary("alice").items[0].payload.folderId).toBe("child");
        saveAssetFolders(database, "alice", folders.slice(0, 1), 1);
        expect(database.loadAssetLibrary("alice").items[0].payload).toMatchObject({ folderId: "parent", data: { content: "原文" } });
        expect(database.loadAssetLibrary("bob").items[0].payload.folderId).toBe("child");
        expect(database.queryAssetLibrary("alice", { page: 1, pageSize: 10, folderId: "child" }).total).toBe(0);
        expect(database.queryAssetLibrary("alice", { page: 1, pageSize: 10, folderId: "parent" }).total).toBe(1);
        expect(() => assertAssetFolder(database, "alice", { folderId: "child" })).toThrow("已移除");
        expect(() => assertAssetFolder(database, "bob", { folderId: "child" })).not.toThrow();
    } finally { database.close(); rmSync(dataDir, { recursive: true, force: true }); }
});

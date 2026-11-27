import type { AppDatabase } from "../db/database";
import { AssetLibraryInputError } from "./asset-library";
import { ASSET_FOLDERS_KEY, normalizeAssetFolders, removedFolderDestination, type AssetFolderSnapshot } from "../../shared/asset-folders";

export function readAssetFolders(database: AppDatabase, userId: string): AssetFolderSnapshot {
    return database.loadUserPreference(userId, ASSET_FOLDERS_KEY) as AssetFolderSnapshot || { revision: 0, folders: [] };
}

export function saveAssetFolders(database: AppDatabase, userId: string, input: unknown, expectedRevision: number): AssetFolderSnapshot {
    const folders = normalizeAssetFolders(input);
    return database.transaction(() => {
        const previous = readAssetFolders(database, userId);
        if (previous.revision !== expectedRevision) throw Object.assign(new Error("文件夹已在其他页面更新，请重新读取后操作"), { status: 409 });
        const next = { revision: previous.revision + 1, folders };
        const removed = previous.folders.filter(folder => !folders.some(item => item.id === folder.id));
        for (const folder of removed) {
            const target = removedFolderDestination(folder.id, previous.folders, folders);
            database.raw!.query("UPDATE asset_library_items SET payload_json = json_set(payload_json, '$.folderId', ?, '$.updatedAt', ?), updated_at = ? WHERE user_id = ? AND json_extract(payload_json, '$.folderId') = ?")
                .run(target, new Date().toISOString(), Date.now(), userId, folder.id);
        }
        database.saveUserPreference(userId, ASSET_FOLDERS_KEY, next);
        return next;
    });
}

export function assertAssetFolder(database: AppDatabase, userId: string, payload: Record<string, unknown>) {
    if (payload.folderId && !readAssetFolders(database, userId).folders.some(folder => folder.id === payload.folderId)) throw new AssetLibraryInputError("目标文件夹已移除，请重新选择文件夹");
}

export function moveLibraryAsset(database: AppDatabase, userId: string, id: string, folderId: unknown) {
    if (folderId !== null && (typeof folderId !== "string" || !folderId)) throw new AssetLibraryInputError("目标文件夹无效");
    return database.transaction(() => {
        assertAssetFolder(database, userId, { folderId });
        const now = new Date();
        const row = database.raw!.query<{ payload_json: string }, [string | null, string, number, string, string]>(
            "UPDATE asset_library_items SET payload_json = json_set(payload_json, '$.folderId', ?, '$.updatedAt', ?), updated_at = ? WHERE user_id = ? AND asset_id = ? RETURNING payload_json",
        ).get(folderId, now.toISOString(), now.getTime(), userId, id);
        return row ? JSON.parse(row.payload_json) as Record<string, unknown> : null;
    });
}

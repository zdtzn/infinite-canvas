import { nanoid } from "nanoid";
import type { Asset } from "./use-asset-store";
import { mergeAssetRecords } from "./asset-library-sync";

export type AssetSyncStatus = "local" | "pending" | "failed" | "synced";
export const ASSET_SYNC_SUCCESS_EVENT = "canvas:asset-sync-success";
export type AssetSyncSuccessDetail = { userId: string; assetId: string; operation: "upsert" | "delete" };
export type AssetSyncEntry = {
    userId: string;
    assetId: string;
    asset?: Asset;
    operation: "upsert" | "delete";
    revision: string;
    status: "pending" | "failed";
    attempts: number;
    retryAt: number;
    error?: string;
};

// Persist the attempt budget, so reloads and repeated online events cannot retry forever.
export const ASSET_SYNC_MAX_ATTEMPTS = 3;
export const assetSyncRetryDelay = (attempts: number) => (attempts === 1 ? 1000 : 5000);

export function queueAssetSync(outbox: AssetSyncEntry[], mutation: Pick<AssetSyncEntry, "userId" | "assetId" | "asset" | "operation">) {
    const entry: AssetSyncEntry = { ...mutation, revision: nanoid(), status: "pending", attempts: 0, retryAt: 0 };
    return [...outbox.filter((item) => item.userId !== entry.userId || item.assetId !== entry.assetId), entry];
}

export function pendingAssetRecords(outbox: AssetSyncEntry[], userId: string) {
    return outbox.filter((entry) => entry.userId === userId && entry.asset).map((entry) => entry.asset!);
}

/** Use outside remote pagination so an unacknowledged save is always visible. */
export function pendingAssetUpserts(outbox: AssetSyncEntry[], userId: string) {
    return pendingAssetRecords(
        outbox.filter((entry) => entry.operation === "upsert"),
        userId,
    );
}

export function preservePendingAssets(assets: Asset[], outbox: AssetSyncEntry[], userId: string) {
    const pending = pendingAssetRecords(outbox, userId);
    return mergeAssetRecords(pending, assets, new Set(pending.map((asset) => asset.id)));
}

export function assetSaveMessage(status: AssetSyncStatus) {
    if (status === "synced") return "已同步到云端";
    if (status === "failed") return "已保存到本机，云端同步失败，可在藏卷阁重试";
    if (status === "pending") return "已保存到本机，等待云端同步";
    return "已保存到本机";
}

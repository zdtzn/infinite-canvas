import { Check, CircleAlert, CloudUpload, RefreshCw } from "lucide-react";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

/** Omit assetId for the library toolbar; supply it for a card's sync status. */
export function AssetSyncStatus({ assetId, className = "" }: { assetId?: string; className?: string }) {
    const ownerUserId = useAssetStore((state) => state.ownerUserId);
    const userId = useUserStore((state) => state.user?.id);
    const outbox = useAssetStore((state) => state.syncOutbox);
    const syncingAssetId = useAssetStore((state) => state.syncingAssetId);
    const storageError = useAssetStore((state) => state.syncStorageError);
    const serverHydrated = useAssetStore((state) => state.serverHydrated);
    const retry = useAssetStore((state) => state.retryAssetSync);
    if (!PUBLIC_MODE || !userId || ownerUserId !== userId) return null;

    const entries = outbox.filter((entry) => entry.userId === userId && (!assetId || entry.assetId === assetId));
    const failed = entries.filter((entry) => entry.status === "failed").length;
    const pending = entries.length - failed;
    const syncing = Boolean(syncingAssetId && (!assetId || syncingAssetId === assetId));
    const deleting = assetId && entries[0]?.operation === "delete";
    const error = storageError || entries.find((entry) => entry.error)?.error;
    let label = "已同步到云端";
    if (assetId && deleting) label = failed ? "删除失败，等待重试" : "等待云端确认删除";
    else if (assetId && entries.length) label = failed ? "云端同步失败，本机已保留" : "本机已保存，等待云端同步";
    else if (entries.length) label = [pending ? `${pending} 项等待同步` : "", failed ? `${failed} 项同步失败` : ""].filter(Boolean).join("，");
    else if (!serverHydrated && !assetId) label = "云端素材尚未加载";
    if (storageError) label = storageError;
    const Icon = failed || storageError ? CircleAlert : entries.length || !serverHydrated ? CloudUpload : Check;

    return (
        <span className={`inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground ${className}`} role="status" aria-live="polite" title={error}>
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
            {(entries.length > 0 || storageError || !serverHydrated) && (
                <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    disabled={syncing}
                    aria-label={assetId ? "重试此素材同步" : "重试素材同步"}
                    onClick={() => {
                        void retry(assetId);
                        if (!serverHydrated)
                            void useAssetStore
                                .getState()
                                .hydrateFromServer(userId)
                                .catch(() => undefined);
                    }}
                >
                    <RefreshCw size={12} className={syncing ? "animate-spin" : ""} aria-hidden="true" />
                    {syncing ? "同步中" : "重试"}
                </button>
            )}
        </span>
    );
}

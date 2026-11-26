import { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { fetchServerAssetFolders, saveServerAssetFolders } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { normalizeAssetFolders, removedFolderDestination, type AssetFolder, type AssetFolderSnapshot } from "../../../../shared/asset-folders";

export function useAssetFolders(userId: string, onChange: () => void) {
    const [snapshot, setSnapshot] = useState<AssetFolderSnapshot & { owner: string }>({ owner: userId, revision: 0, folders: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const saving = useRef(false);
    const [refresh, setRefresh] = useState(0);
    const folders = snapshot.owner === userId ? snapshot.folders : [];
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setLoading(true); setError("");
        const read = PUBLIC_MODE ? fetchServerAssetFolders(userId, controller.signal) : localforage.getItem<AssetFolderSnapshot>(`asset-folders:${userId || "local"}`);
        void read.then(value => {
            if (active) setSnapshot({ ...(value || { revision: 0, folders: [] }), owner: userId });
        }).catch(() => { if (active) setError("文件夹读取失败，请重试"); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [userId, refresh]);
    const save = async (input: AssetFolder[]) => {
        if (saving.current || loading || error || snapshot.owner !== userId) throw new Error("请等待文件夹读取完成");
        const next = normalizeAssetFolders(input);
        const owner = userId;
        const assertOwner = () => { if ((useUserStore.getState().user?.id || "") !== owner) throw new Error("账号已切换，请重新操作"); };
        saving.current = true; setBusy(true);
        try {
            assertOwner();
            let value = { revision: snapshot.revision + 1, folders: next };
            if (PUBLIC_MODE) value = await saveServerAssetFolders({ revision: snapshot.revision, folders: next }, owner);
            else await localforage.setItem(`asset-folders:${owner || "local"}`, value);
            assertOwner();
            const kept = new Set(next.map(folder => folder.id));
            const store = useAssetStore.getState();
            for (const asset of store.assets) {
                if (asset.folderId && !kept.has(asset.folderId)) store.updateAsset(asset.id, { folderId: removedFolderDestination(asset.folderId, folders, next) });
            }
            setSnapshot({ ...value, owner }); onChange();
        } catch (reason) {
            setRefresh(value => value + 1);
            throw reason;
        } finally { saving.current = false; setBusy(false); }
    };
    return { folders, loading, error, busy, save, reload: () => setRefresh(value => value + 1) };
}

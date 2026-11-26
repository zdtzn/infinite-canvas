import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { runWithConcurrency } from "@/lib/async-pool";
import { readAssetDownload } from "./asset-download";
import type { Asset } from "@/stores/use-asset-store";
import type { AssetFolder } from "../../../../shared/asset-folders";
import { useUserStore } from "@/stores/use-user-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    folders?: AssetFolder[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], userId: string, assertCurrent: () => void, onProgress: (count: number) => void, folders: AssetFolder[] = []) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    let completed = 0;
    const exportedAssets = await runWithConcurrency(assets, 3, async (asset, index) => {
            assertCurrent();
            if (asset.kind !== "image" && asset.kind !== "video") { onProgress(++completed); return asset; }
            const storageKey = asset.data.storageKey || `${asset.kind}:export-${asset.id}`;
            const { blob } = await readAssetDownload(asset, userId);
            assertCurrent();
            const path = `files/${index}-${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
            onProgress(++completed);
            return { ...asset, data: { ...asset.data, storageKey } } as Asset;
        });

    assertCurrent();
    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets: exportedAssets, folders, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertCurrent();
    saveAs(zip, "我的资产.zip");
}

export async function readAssetPackage(file: File, importFolders?: (folders: AssetFolder[]) => Promise<Map<string, string>>) {
    const owner = useUserStore.getState().user?.id || "";
    const assertOwner = () => { if ((useUserStore.getState().user?.id || "") !== owner) throw new Error("账号已切换，素材导入已停止"); };
    const zip = await readZip(file);
    assertOwner();
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("这不是有效的素材压缩包，请重新导出后再导入");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("素材压缩包格式无效");
    const mapping = importFolders && data.folders ? await importFolders(data.folders) : new Map<string, string>();
    assertOwner();
    await Promise.all(
        data.files.map(async (item) => {
            assertOwner();
            const blob = zip.get(item.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob, owner) : setMediaBlob(item.storageKey, typedBlob, owner));
        }),
    );
    assertOwner();
    return data.assets.map(asset => ({ ...asset, folderId: asset.folderId ? mapping.get(asset.folderId) || null : null }));
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}

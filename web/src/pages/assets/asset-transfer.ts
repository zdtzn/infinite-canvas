import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { deleteStoredMedia, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, setImageBlob } from "@/services/image-storage";
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

export async function readAssetPackage(file: File, importFolders?: (folders: AssetFolder[]) => Promise<Map<string, string>>, owner = useUserStore.getState().user?.id || ""): Promise<Asset[]> {
    const assertOwner = () => { if ((useUserStore.getState().user?.id || "") !== owner) throw new Error("账号已切换，素材导入已停止"); };
    assertOwner();
    const zip = await readZip(file);
    assertOwner();
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("这不是有效的素材压缩包，请重新导出后再导入");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data?.app !== "infinite-canvas" || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("素材压缩包格式无效");
    const files = new Map(data.files.map(item => [item.storageKey, item]));
    const originals = new Map<string, { kind: "image" | "video"; blob: Blob }>();
    for (const asset of data.assets) {
        if (asset?.kind === "text" && typeof asset.data?.content === "string") continue;
        if (asset?.kind !== "image" && asset?.kind !== "video") throw new Error("素材压缩包中的记录格式无效");
        const key = asset.data?.storageKey;
        const item = typeof key === "string" ? files.get(key) : undefined;
        const blob = item && zip.get(item.path);
        if (!key || !item || !blob?.size || blob.size !== item.bytes || !item.mimeType?.startsWith(asset.kind + "/")) {
            throw new Error("素材压缩包中的原文件缺失或损坏，请重新导出");
        }
        originals.set(key, { kind: asset.kind, blob: blob.slice(0, blob.size, item.mimeType) });
    }

    // A backup can come from another device or account. Allocate destination keys before linking any records.
    const restored = new Map<string, { key: string; url: string }>();
    try {
        for (const [source, { kind, blob }] of originals) {
            assertOwner();
            const key = `${kind}:${crypto.randomUUID()}`;
            const url = await (kind === "image" ? setImageBlob(key, blob, owner) : setMediaBlob(key, blob, owner));
            restored.set(source, { key, url });
        }
        assertOwner();
        const mapping = importFolders && data.folders ? await importFolders(data.folders) : new Map<string, string>();
        assertOwner();
        return data.assets.map(asset => {
            const folderId = asset.folderId ? mapping.get(asset.folderId) ?? null : null;
            if (asset.kind === "text") return { ...asset, folderId };
            const { key, url } = restored.get(asset.data.storageKey!)!;
            if (asset.kind === "video") return { ...asset, folderId, coverUrl: url, data: { ...asset.data, storageKey: key, url } };
            // The package contains originals. The library rebuilds its thumbnail from this device's copy.
            const { thumbnailKey, thumbnailUrl, ...image } = asset.data;
            return { ...asset, folderId, coverUrl: url, data: { ...image, dataUrl: url, storageKey: key } };
        });
    } catch (error) {
        const keys = [...restored.values()].map(item => item.key);
        await Promise.allSettled([deleteStoredImages(keys.filter(key => key.startsWith("image:")), owner), deleteStoredMedia(keys.filter(key => key.startsWith("video:")), owner)]);
        throw error;
    }
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

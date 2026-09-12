import { getImageBlob, readImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { fetchServerResource } from "@/services/server-api";
import type { Asset } from "@/stores/use-asset-store";

export async function readAssetDownload(asset: Extract<Asset, { kind: "image" | "video" }>, userId: string, readers = { getImageBlob, getMediaBlob, readImageBlob, fetchServerResource }) {
    let blob: Blob | null = null;
    if (asset.data.storageKey) blob = await (asset.kind === "image" ? readers.getImageBlob(asset.data.storageKey, userId) : readers.getMediaBlob(asset.data.storageKey, userId));
    if (!blob) {
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        if (!url) throw new Error("原始文件地址缺失，无法下载");
        if (asset.kind === "image") blob = await readers.readImageBlob(url, userId);
        else {
            const response = await readers.fetchServerResource(url, {}, userId);
            if (!response.ok) throw new Error(`读取视频失败（${response.status}）`);
            blob = await response.blob();
        }
    }
    if (!blob.size || /(?:text\/html|application\/json)/i.test(blob.type)) throw new Error("下载失败：返回的内容不是媒体文件");
    const mime = blob.type || asset.data.mimeType;
    const ext = ({ "image/jpeg": "jpg", "image/svg+xml": "svg", "video/quicktime": "mov" } as Record<string, string>)[mime] || mime.split("/")[1]?.split(/[;+]/)[0] || (asset.kind === "image" ? "png" : "mp4");
    const title = (asset.title || "asset").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "asset";
    return { blob, filename: title.toLowerCase().endsWith(`.${ext}`) ? title : `${title}.${ext}` };
}

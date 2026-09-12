import { expect, mock, test } from "bun:test";
import { readAssetDownload } from "./asset-download";
import type { ImageAsset } from "@/stores/use-asset-store";

const asset: ImageAsset = {
    id: "a",
    kind: "image",
    title: "诸天·原图",
    coverUrl: "https://image.test/thumbnail",
    tags: [],
    createdAt: "",
    updatedAt: "",
    data: { dataUrl: "https://image.test/original", storageKey: "image:original", thumbnailUrl: "https://image.test/thumbnail", width: 100, height: 100, bytes: 10, mimeType: "image/png" },
};
function readers(blob: Blob | null) {
    return {
        getImageBlob: mock(async () => blob),
        getMediaBlob: mock(async () => blob),
        readImageBlob: mock(async () => new Blob(["original"], { type: "image/jpeg" })),
        fetchServerResource: mock(async () => new Response("video", { headers: { "Content-Type": "video/mp4" } })),
    };
}
test("downloads the original stored blob with Unicode name, never the thumbnail", async () => {
    const blob = new Blob(["original"], { type: "image/png" });
    const io = readers(blob);
    expect(await readAssetDownload(asset, "alice", io)).toEqual({ blob, filename: "诸天·原图.png" });
    expect(io.getImageBlob).toHaveBeenCalledWith("image:original", "alice");
    expect(io.readImageBlob).not.toHaveBeenCalled();
});
test("missing local blob falls back to original URL and keeps account binding", async () => {
    const io = readers(null);
    const result = await readAssetDownload(asset, "alice", io);
    expect(io.readImageBlob).toHaveBeenCalledWith(asset.data.dataUrl, "alice");
    expect(result.filename).toBe("诸天·原图.jpg");
});
test("download rejects error pages and does not hide storage authorization errors", async () => {
    await expect(readAssetDownload(asset, "alice", readers(new Blob(["login"], { type: "text/html" })))).rejects.toThrow("不是媒体");
    const io = readers(null);
    io.getImageBlob.mockImplementation(async () => {
        throw new Error("账号已切换");
    });
    await expect(readAssetDownload(asset, "bob", io)).rejects.toThrow("账号已切换");
    expect(io.readImageBlob).not.toHaveBeenCalled();
});

import type { RequestedImage } from "@/services/api/image";
import { archiveDeferredServerJob, fetchServerJob } from "@/services/server-api";
import { uploadImage, publicImageAssetUrl, type UploadedImage } from "@/services/image-storage";
import { imageMetadata as storedImageMetadata } from "./canvas-node-factory";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";
import { useUserStore } from "@/stores/use-user-store";
import { PUBLIC_MODE } from "@/constant/runtime-config";

export type CanvasImageSave = { jobId: string; imageId: string; userId: string; outputFormat?: string; state: "pending" | "failed"; error?: string };
type GeneratedUpload = UploadedImage & { imageSave?: CanvasImageSave };
export function imageSaveState(metadata?: CanvasNodeMetadata) {
    return (metadata as (CanvasNodeMetadata & { imageSave?: CanvasImageSave }) | undefined)?.imageSave;
}
export function canvasImageMetadata(image: GeneratedUpload): CanvasNodeMetadata & { imageSave?: CanvasImageSave } {
    return { ...storedImageMetadata(image), thumbnailKey: image.thumbnailKey, thumbnailUrl: image.thumbnailUrl, imageSave: image.imageSave };
}

// A batch cover must carry the same durable resource and pending save as its child.
export function canvasImageResourceMetadata(metadata: CanvasNodeMetadata) {
    return {
        content: metadata.content,
        storageKey: metadata.storageKey,
        thumbnailKey: metadata.thumbnailKey,
        thumbnailUrl: metadata.thumbnailUrl,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        jobId: metadata.jobId,
        imageSave: imageSaveState(metadata),
    };
}

// Run the session check inside React's functional update: a callback can be queued
// before navigation/sign-out but execute afterwards. Only update the original save.
export function applyCanvasImageSaveResult(nodes: CanvasNodeData[], save: CanvasImageSave, result: { uploaded: UploadedImage } | { error: string }, isCurrent: () => boolean) {
    if (!isCurrent()) return nodes;
    let changed = false;
    const next = nodes.map((node) => {
        const current = imageSaveState(node.metadata);
        if (current?.state !== "pending" || current.jobId !== save.jobId || current.imageId !== save.imageId || current.userId !== save.userId) return node;
        changed = true;
        if ("error" in result) return { ...node, metadata: { ...node.metadata, imageSave: { ...current, state: "failed", error: result.error } } };
        const { uploaded } = result;
        const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
        return { ...node, ...size, metadata: { ...node.metadata, ...canvasImageMetadata(uploaded), status: node.metadata?.status || ("success" as const) } };
    });
    return changed ? next : nodes;
}

// Per-page promises are never serialized. Reloads and retries use the existing job.
export function createCanvasImageSaver(deps = { upload: uploadImage, fetch: fetchServerJob, archive: archiveDeferredServerJob }, currentUserId = () => useUserStore.getState().user?.id || "") {
    const sources = new WeakMap<CanvasImageSave, RequestedImage["archiveResult"]>();
    const runs = new Map<string, { pending: Promise<UploadedImage>; cancel: () => void }>();
    const key = (save: CanvasImageSave) => `${save.userId}:${save.jobId}:${save.imageId}`;
    function saveImage(save: CanvasImageSave) {
        const existing = runs.get(key(save));
        if (existing) return existing.pending;
        const result = sources.get(save);
        sources.delete(save);
        let canceled = false;
        const pending = (async () => {
            const assertOwner = () => {
                if (canceled) throw new DOMException("Save no longer attached", "AbortError");
                if (currentUserId() !== save.userId) throw new DOMException("Account changed", "AbortError");
            };
            assertOwner();
            let resolved: Awaited<NonNullable<RequestedImage["archiveResult"]>>;
            if (result) resolved = await result;
            else {
                const { job } = await deps.fetch(save.jobId, save.userId);
                assertOwner();
                resolved = { job: await deps.archive(job, save.userId) };
            }
            assertOwner();
            if ("error" in resolved) throw resolved.error;
            const image = resolved.job.result?.images.find((image) => image.id === save.imageId);
            if (!image || image.persisted === false) throw new Error("图片已生成，保存尚未完成，请重试保存");
            const uploaded = await deps.upload(image.dataUrl, { expectedUserId: save.userId, outputFormat: save.outputFormat, createThumbnail: false });
            assertOwner();
            // Promotion may return the expiring job-file URL. Persist the asset URL.
            return { ...uploaded, url: PUBLIC_MODE ? publicImageAssetUrl(uploaded.storageKey) : uploaded.url };
        })();
        runs.set(key(save), {
            pending,
            cancel: () => {
                canceled = true;
            },
        });
        void pending.catch(() => undefined);
        return pending;
    }
    function retain(saves: CanvasImageSave[]) {
        const live = new Set(saves.map(key));
        for (const [id, run] of runs) {
            if (live.has(id)) continue;
            run.cancel();
            runs.delete(id);
        }
    }
    return {
        save: saveImage,
        retain,
        dispose: () => retain([]),
        forget: (save: CanvasImageSave) => {
            runs.get(key(save))?.cancel();
            runs.delete(key(save));
        },
        async prepare(image: RequestedImage, outputFormat?: string): Promise<GeneratedUpload> {
            if (!image.jobId) return deps.upload(image.dataUrl, { outputFormat });
            const imageSave: CanvasImageSave = { jobId: image.jobId, imageId: image.id, userId: image.expectedUserId ?? useUserStore.getState().user?.id ?? "", outputFormat, state: "pending" };
            if (currentUserId() !== imageSave.userId) throw new DOMException("Account changed", "AbortError");
            // Start promotion only once the preview is attached to a live node.
            // Unconsumed previews are weakly held and disappear with their metadata.
            sources.set(imageSave, image.archiveResult);
            return { url: image.dataUrl, storageKey: "", width: image.width || 1024, height: image.height || 1024, bytes: image.bytes || 0, mimeType: image.mimeType || "image/png", imageSave };
        },
    };
}

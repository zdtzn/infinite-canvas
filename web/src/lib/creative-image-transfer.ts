export const CREATIVE_IMAGE_TRANSFER_STATE_KEY = "creativeImageTransfer";

export type CreativeImageTransfer = {
    id: string;
    source: "image-workbench";
    ownerUserId?: string;
    title: string;
    prompt: string;
    dataUrl: string;
    storageKey?: string;
    thumbnailKey?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export function creativeImageTransferState(transfer: CreativeImageTransfer) {
    return { [CREATIVE_IMAGE_TRANSFER_STATE_KEY]: transfer };
}

export function readCreativeImageTransfer(state: unknown, expectedUserId?: string): CreativeImageTransfer | null {
    if (!state || typeof state !== "object") return null;
    const transfer = (state as Record<string, unknown>)[CREATIVE_IMAGE_TRANSFER_STATE_KEY];
    if (!transfer || typeof transfer !== "object") return null;
    const value = transfer as Partial<CreativeImageTransfer>;
    if (expectedUserId !== undefined && value.ownerUserId !== expectedUserId) return null;
    if (value.source !== "image-workbench" || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.prompt !== "string" || typeof value.dataUrl !== "string" || !value.dataUrl) return null;
    return value as CreativeImageTransfer;
}

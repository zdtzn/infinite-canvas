import { describe, expect, test } from "bun:test";

import { creativeImageTransferState, readCreativeImageTransfer, type CreativeImageTransfer } from "./creative-image-transfer";

describe("creative image transfer", () => {
    test("round trips a valid image transfer", () => {
        const transfer: CreativeImageTransfer = {
            id: "result-1",
            source: "image-workbench",
            title: "生成结果 1",
            prompt: "一座山",
            dataUrl: "/api/images/result-1",
            storageKey: "image:result-1",
            width: 1024,
            height: 1024,
        };

        expect(readCreativeImageTransfer(creativeImageTransferState(transfer))).toEqual(transfer);
    });

    test("rejects unrelated route state", () => {
        expect(readCreativeImageTransfer(null)).toBeNull();
        expect(readCreativeImageTransfer({ creativeImageTransfer: { source: "other", id: "1", title: "", prompt: "", dataUrl: "/image" } })).toBeNull();
        expect(readCreativeImageTransfer({ creativeImageTransfer: { source: "image-workbench", id: "1", title: "", prompt: "", dataUrl: "" } })).toBeNull();
    });

    test("account-bound consumers reject stale or legacy route payloads", () => {
        const transfer: CreativeImageTransfer = { id: "r", source: "image-workbench", ownerUserId: "a", title: "result", prompt: "p", dataUrl: "data:image/png;base64,AAAA" };
        expect(readCreativeImageTransfer(creativeImageTransferState(transfer), "a")).toEqual(transfer);
        expect(readCreativeImageTransfer(creativeImageTransferState(transfer), "b")).toBeNull();
        expect(readCreativeImageTransfer(creativeImageTransferState({ ...transfer, ownerUserId: undefined }), "a")).toBeNull();
        expect(readCreativeImageTransfer(creativeImageTransferState({ ...transfer, ownerUserId: undefined }))).not.toBeNull();
    });
});

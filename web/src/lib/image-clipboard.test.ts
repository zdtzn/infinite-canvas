import { expect, test } from "bun:test";

import { getClipboardImageFiles } from "./image-clipboard";

test("reads image files from clipboard items before the generic file list", () => {
    const itemFile = new File(["png"], "clipboard.png", { type: "image/png" });
    const fallbackFile = new File(["jpg"], "fallback.jpg", { type: "image/jpeg" });
    const data = {
        items: [
            { type: "text/plain", getAsFile: () => null },
            { type: "image/png", getAsFile: () => itemFile },
        ],
        files: [fallbackFile],
    } as unknown as DataTransfer;

    expect(getClipboardImageFiles(data)).toEqual([itemFile]);
});

test("falls back to clipboard files when items cannot expose an image", () => {
    const file = new File(["webp"], "clipboard.webp", { type: "image/webp" });
    const data = { items: [{ type: "image/webp", getAsFile: () => null }], files: [file] } as unknown as DataTransfer;

    expect(getClipboardImageFiles(data)).toEqual([file]);
});

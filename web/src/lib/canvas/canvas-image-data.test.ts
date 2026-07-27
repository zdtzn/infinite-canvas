import { afterEach, describe, expect, test } from "bun:test";

import { buildSplitLayout, splitImageBlobs } from "./canvas-image-data";

const originalDocument = globalThis.document;
const originalImage = globalThis.Image;

afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.Image = originalImage;
});

test("splits images into blobs without synchronous data URL encoding", async () => {
    let dataUrlCalled = false;

    globalThis.Image = class {
        width = 400;
        height = 300;
        onload: (() => void) | null = null;

        set src(_value: string) {
            queueMicrotask(() => this.onload?.());
        }
    } as unknown as typeof Image;

    globalThis.document = {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toDataURL: () => {
                dataUrlCalled = true;
                return "";
            },
            toBlob: (callback: BlobCallback, type?: string) => callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type })),
        }),
    } as unknown as Document;

    const pieces = await splitImageBlobs("blob:source", { rows: 2, columns: 2 });

    expect(dataUrlCalled).toBe(false);
    expect(pieces).toHaveLength(4);
    expect(pieces.map(({ row, column, width, height }) => ({ row, column, width, height }))).toEqual([
        { row: 0, column: 0, width: 200, height: 150 },
        { row: 0, column: 1, width: 200, height: 150 },
        { row: 1, column: 0, width: 200, height: 150 },
        { row: 1, column: 1, width: 200, height: 150 },
    ]);
    expect(pieces.every((piece) => piece.blob.type === "image/png")).toBe(true);
});

describe("buildSplitLayout", () => {
    test("preserves non-uniform source proportions and grid gaps", () => {
        const pieces = [
            { row: 0, column: 0, width: 400, height: 300 },
            { row: 0, column: 1, width: 600, height: 300 },
            { row: 1, column: 0, width: 400, height: 700 },
            { row: 1, column: 1, width: 600, height: 700 },
        ];

        expect(buildSplitLayout(pieces, 500, 400, 16)).toEqual([
            { row: 0, column: 0, x: 0, y: 0, width: 200, height: 120 },
            { row: 0, column: 1, x: 216, y: 0, width: 300, height: 120 },
            { row: 1, column: 0, x: 0, y: 136, width: 200, height: 280 },
            { row: 1, column: 1, x: 216, y: 136, width: 300, height: 280 },
        ]);
    });

    test("returns an empty layout when there are no pieces", () => {
        expect(buildSplitLayout([], 500, 400, 16)).toEqual([]);
    });
});

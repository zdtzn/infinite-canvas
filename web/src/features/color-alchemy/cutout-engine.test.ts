import { describe, expect, test } from "bun:test";

import { DEFAULT_CUTOUT_SETTINGS, normalizeCutoutSettings, refineCutoutPixels } from "./cutout-engine";

describe("灵彩抠图边缘处理", () => {
    test("normalizes edge settings into the supported range", () => {
        expect(normalizeCutoutSettings({ edgeEnhancement: 140, edgeSoftness: -10, decontaminate: Number.NaN })).toEqual({
            edgeEnhancement: 100,
            edgeSoftness: 0,
            decontaminate: 0,
        });
        expect(normalizeCutoutSettings()).toEqual(DEFAULT_CUTOUT_SETTINGS);
    });

    test("sharpens a semi-transparent boundary without changing the opaque interior", () => {
        const image = createImage(3, 1, [0, 96, 255]);
        refineCutoutPixels(image, { edgeEnhancement: 100, edgeSoftness: 0, decontaminate: 0 });
        expect(image.data[3]).toBe(0);
        expect(image.data[7]).toBeLessThan(96);
        expect(image.data[11]).toBe(255);
    });

    test("softens a hard alpha boundary into a transitional edge", () => {
        const image = createImage(3, 1, [0, 0, 255]);
        refineCutoutPixels(image, { edgeEnhancement: 0, edgeSoftness: 100, decontaminate: 0 });
        expect(image.data[7]).toBeGreaterThan(0);
        expect(image.data[7]).toBeLessThan(128);
    });

    test("decontaminates edge pixels toward nearby foreground color", () => {
        const image = createImage(3, 1, [255, 128, 0]);
        image.data.set([255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 0, 0]);
        refineCutoutPixels(image, { edgeEnhancement: 0, edgeSoftness: 0, decontaminate: 100 });
        expect(image.data[4]).toBeGreaterThan(255 - 1);
        expect(image.data[5]).toBeLessThan(255);
        expect(image.data[6]).toBeLessThan(255);
    });
});

function createImage(width: number, height: number, alpha: number[]) {
    const data = new Uint8ClampedArray(width * height * 4);
    alpha.forEach((value, index) => {
        data[index * 4] = 80;
        data[index * 4 + 1] = 90;
        data[index * 4 + 2] = 100;
        data[index * 4 + 3] = value;
    });
    return { data, width, height } as ImageData;
}

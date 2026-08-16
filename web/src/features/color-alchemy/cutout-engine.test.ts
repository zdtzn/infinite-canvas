import { describe, expect, test } from "bun:test";

import { cutoutErrorMessage, DEFAULT_CUTOUT_SETTINGS, normalizeCutoutSettings, refineCutoutPixels, runBackgroundRemovalWithFallback } from "./cutout-engine";

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

describe("灵彩抠图运行时", () => {
    test("uses a clean CPU runtime even when WebGPU is available", async () => {
        const configs: Array<{ device: string; publicPath?: string }> = [];
        const resultBlob = { text: async () => "cutout" } as Blob;
        const result = await runBackgroundRemovalWithFallback(
            {} as Blob,
            async (_source, config) => {
                configs.push(config);
                return resultBlob;
            },
            true,
        );

        expect(configs).toHaveLength(1);
        expect(configs[0]?.device).toBe("cpu");
        expect(new URL(configs[0]?.publicPath || "http://invalid").pathname).toBe("/background-removal/1.7.0/");
        expect(await result.text()).toBe("cutout");
    });

    test("uses CPU directly when WebGPU is unavailable", async () => {
        const devices: string[] = [];
        await runBackgroundRemovalWithFallback(
            {} as Blob,
            async (_source, config) => {
                devices.push(config.device);
                return {} as Blob;
            },
            false,
        );

        expect(devices).toEqual(["cpu"]);
    });

    test("turns a poisoned ONNX runtime error into a recoverable Chinese message", () => {
        expect(cutoutErrorMessage(new Error("previous call to initWasm() failed"))).toBe("抠图运行组件初始化失败，请刷新页面后重试；若仍失败，请清除本站缓存后重新打开。");
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

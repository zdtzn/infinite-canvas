import { expect, test } from "bun:test";
import sharp from "sharp";
import { mergeImageEditPixels } from "../../shared/image-edit-pixels";
import { assertLocalEditInputs, finalizeLocalEdit } from "./local-image-edit";

const png = (pixels: number[], width: number, height: number) => sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer();

test("local edits keep original RGBA outside the selection and can erase inside it", async () => {
    const original = await png([24, 56, 94, 123, 225, 170, 20, 255], 2, 1);
    const mask = await png([255, 255, 255, 255, 0, 0, 0, 0], 2, 1);
    const generated = await png([0, 0, 0, 0], 1, 1);
    const output = await finalizeLocalEdit(original, mask, generated, new AbortController().signal);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([2, 1, 4]);
    expect(Array.from(data)).toEqual([24, 56, 94, 123, 0, 0, 0, 0]);
});

test("transparent edits preserve every source alpha and use the source color where the edit is invisible", async () => {
    const original = await png([
        10, 20, 30, 0, 120, 130, 140, 96, 25, 35, 45, 255,
        17, 18, 19, 72, 89, 90, 91, 64, 60, 120, 180, 144,
    ], 6, 1);
    const selection = await png([
        255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 0,
        255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 128,
    ], 6, 1);
    const generated = await png([
        230, 170, 0, 255, 40, 50, 60, 255, 100, 110, 120, 10,
        4, 5, 6, 255, 0, 0, 0, 0, 20, 40, 60, 24,
    ], 6, 1);
    const signal = new AbortController().signal;

    const protectedResult = await finalizeLocalEdit(original, selection, generated, signal, true);
    expect(Array.from(await sharp(protectedResult).raw().toBuffer())).toEqual([
        10, 20, 30, 0, 80, 90, 100, 96, 100, 110, 120, 255,
        17, 18, 19, 72, 89, 90, 91, 64, 40, 80, 120, 144,
    ]);

    const defaultResult = await finalizeLocalEdit(original, selection, generated, signal);
    const defaultPixels = await sharp(defaultResult).raw().toBuffer();
    expect(Array.from(defaultPixels.subarray(0, 4))).toEqual([230, 170, 0, 255]);
    expect(defaultPixels[7]).toBeGreaterThan(96);
    expect(defaultPixels[19]).toBe(0);
});

test("a flattened edit changes the opaque subject and keeps the original translucent shadow colors", async () => {
    const original = await png([
        238, 173, 41, 255, 17, 24, 39, 104, 17, 25, 38, 100, 0, 0, 0, 0, 92, 80, 61, 72,
    ], 5, 1);
    const selection = await png([
        255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 0, 255, 255, 255, 255,
    ], 5, 1);
    const flattened = await sharp(Buffer.from([
        124, 225, 66, 81, 81, 80, 59, 58, 57, 236, 235, 235, 233, 232, 231,
    ]), { raw: { width: 5, height: 1, channels: 3 } }).png().toBuffer();

    const output = await finalizeLocalEdit(original, selection, flattened, new AbortController().signal, true);

    expect(Array.from(await sharp(output).raw().toBuffer())).toEqual([
        124, 225, 66, 255, 17, 24, 39, 104, 17, 25, 38, 100, 0, 0, 0, 0, 92, 80, 61, 72,
    ]);
});

test("a shifted transparent edit aligns each selected subject while retaining the source shadows", () => {
    const width = 160;
    const height = 144;
    const original = new Uint8Array(width * height * 4);
    const generated = new Uint8Array(original.length);
    const keep = new Uint8Array(width * height).fill(255);
    const fill = (pixels: Uint8Array, bounds: [number, number, number, number], color: number[]) => {
        const [left, top, right, bottom] = bounds;
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) pixels.set(color, (y * width + x) * color.length);
        }
    };
    const green = [83, 190, 27, 255];
    const pink = [226, 53, 172, 255];
    const shadow = [17, 24, 39, 104];
    fill(original, [16, 24, 48, 48], [238, 173, 41, 255]);
    fill(original, [100, 82, 128, 110], [57, 126, 210, 255]);
    fill(original, [16, 48, 48, 54], shadow);
    fill(original, [100, 110, 128, 116], shadow);
    fill(original, [68, 28, 78, 40], [255, 0, 0, 255]);
    fill(keep, [9, 15, 61, 66], [0]);
    fill(keep, [91, 71, 140, 125], [0]);
    fill(generated, [23, 19, 59, 48], green);
    fill(generated, [94, 87, 128, 120], pink);
    fill(generated, [23, 48, 59, 56], [56, 56, 56, 95]);

    mergeImageEditPixels(original, generated, keep, 1, width, height, true);

    const pixel = (x: number, y: number) => Array.from(original.subarray((y * width + x) * 4, (y * width + x + 1) * 4));
    expect(pixel(19, 29)).toEqual(green);
    expect(pixel(102, 84)).toEqual(pink);
    expect(pixel(30, 50)).toEqual(shadow);
    expect(pixel(108, 112)).toEqual(shadow);
    expect(pixel(70, 35)).toEqual([255, 0, 0, 255]);
});

test("rejects an invalid selection before an edit can run", async () => {
    const original = await png([24, 56, 94, 255, 225, 170, 20, 255], 2, 1);
    const mask = await png([0, 0, 0, 0], 1, 1);
    await expect(assertLocalEditInputs(original, mask)).rejects.toThrow("原图尺寸一致");
});

test("the feather starts inside the selected area and reaches full strength in its center", () => {
    const width = 256;
    const height = 256;
    const original = new Uint8Array(width * height * 4).fill(255);
    const edited = new Uint8Array(original.length).fill(255);
    const keep = new Uint8Array(width * height).fill(255);
    for (let y = 64; y < 192; y++) keep.fill(0, y * width + 64, y * width + 192);
    for (let i = 0; i < edited.length; i += 4) edited[i] = 0;
    mergeImageEditPixels(original, edited, keep, 1, width, height);
    const sample = (x: number) => original[(128 * width + x) * 4];
    expect(sample(63)).toBe(255);
    expect(sample(64)).toBeGreaterThan(sample(65));
    expect(sample(65)).toBeGreaterThan(0);
    expect(sample(128)).toBe(0);
});

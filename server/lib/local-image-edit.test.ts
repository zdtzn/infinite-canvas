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

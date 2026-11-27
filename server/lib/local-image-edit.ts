import sharp from "sharp";
import { mergeImageEditPixels } from "../../shared/image-edit-pixels";

type ImageInput = string | Buffer;
const decodeOptions = { limitInputPixels: 50_000_000 };

export async function assertLocalEditInputs(original: ImageInput, mask: ImageInput) {
    const [source, selection] = await Promise.all([sharp(original, decodeOptions).metadata(), sharp(mask, decodeOptions).metadata()]);
    const size = source.autoOrient;
    if (size.width * size.height > decodeOptions.limitInputPixels || selection.format !== "png" || !selection.hasAlpha || selection.width !== size.width || selection.height !== size.height) {
        throw new Error("选区蒙版必须是和原图尺寸一致的透明 PNG");
    }
    return size;
}

export async function finalizeLocalEdit(original: ImageInput, mask: ImageInput, edited: Uint8Array, signal: AbortSignal) {
    const { width, height } = await assertLocalEditInputs(original, mask);
    signal.throwIfAborted();
    const [source, selection, result] = await Promise.all([
        sharp(original, decodeOptions).autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer(),
        sharp(mask, decodeOptions).extractChannel("alpha").raw().toBuffer(),
        sharp(edited, decodeOptions).autoOrient().resize(width, height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer(),
    ]);
    signal.throwIfAborted();
    mergeImageEditPixels(source, result, selection, 1, width, height);
    return sharp(source, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

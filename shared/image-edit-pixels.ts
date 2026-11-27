import { alignedEditOffset, findImageEditAlignments, imageEditAlignmentAt, OPAQUE_CORE_ALPHA } from "./image-edit-alignment";

type Pixels = Uint8Array | Uint8ClampedArray;

function hasTransparency(pixels: Pixels) {
    for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] !== 255) return true;
    }
    return false;
}

function softenSelectionEdges(width: number, height: number, keep: Pixels, channels: 1 | 4) {
    const radius = Math.min(16, Math.round(Math.min(width, height) / 64));
    if (radius < 2) return null;

    // Measure inward distance to the opaque part of the mask, capped at the feather radius.
    const distances = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            if (keep[(index + 1) * channels - 1] === 255) continue;
            const left = x > 0 ? distances[index - 1] + 1 : radius;
            const above = y > 0 ? distances[index - width] + 1 : radius;
            distances[index] = Math.min(radius, left, above);
        }
    }
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const index = y * width + x;
            const right = x + 1 < width ? distances[index + 1] + 1 : radius;
            const below = y + 1 < height ? distances[index + width] + 1 : radius;
            distances[index] = Math.min(distances[index], right, below);
        }
    }
    const strengths = Array.from({ length: radius + 1 }, (_, distance) => Math.round(210 * (1 - distance / radius) ** 2));
    for (let index = 0; index < distances.length; index++) distances[index] = strengths[distances[index]];
    return distances;
}

/** The mask's alpha is the proportion of the original pixel to keep. */
export function mergeImageEditPixels(original: Pixels, edited: Pixels, keep: Pixels, maskChannels: 1 | 4, width: number, height: number, preserveSourceTransparency = false) {
    const feather = softenSelectionEdges(width, height, keep, maskChannels);
    const flattenedEdit = preserveSourceTransparency && !hasTransparency(edited);
    const alignments = preserveSourceTransparency && !flattenedEdit && hasTransparency(original)
        ? findImageEditAlignments(original, edited, keep, maskChannels, width, height)
        : [];
    for (let offset = 0, alpha = maskChannels - 1; offset < original.length; offset += 4, alpha += maskChannels) {
        const strength = Math.max(keep[alpha], feather?.[offset / 4] ?? 0);
        if (strength === 255) continue;
        const originalAlpha = original[offset + 3];
        const alignment = imageEditAlignmentAt(offset, width, alignments);
        const alignedOffset = alignedEditOffset(offset, width, alignment);
        const keepTranslucentColors = flattenedEdit || (alignment && (alignedOffset === undefined || originalAlpha < OPAQUE_CORE_ALPHA));
        // Keep the source shadow around a matched subject, including one already in place.
        if (preserveSourceTransparency && (originalAlpha === 0 || (keepTranslucentColors && originalAlpha < 255))) continue;
        const editOffset = alignedOffset ?? offset;
        const generatedAlpha = edited[editOffset + 3];
        if (preserveSourceTransparency && generatedAlpha === 0) continue;
        const editedAlpha = preserveSourceTransparency ? originalAlpha : generatedAlpha;
        if (strength === 0) {
            original[offset] = edited[editOffset];
            original[offset + 1] = edited[editOffset + 1];
            original[offset + 2] = edited[editOffset + 2];
            original[offset + 3] = editedAlpha;
            continue;
        }

        const before = originalAlpha * strength;
        const after = editedAlpha * (255 - strength);
        const alphaSum = before + after;
        for (let channel = 0; channel < 3; channel++) {
            const index = offset + channel;
            original[index] = alphaSum ? Math.round((original[index] * before + edited[editOffset + channel] * after) / alphaSum) : 0;
        }
        original[offset + 3] = Math.round(alphaSum / 255);
    }
}

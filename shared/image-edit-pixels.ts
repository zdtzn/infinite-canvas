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

function editedEdgeColor(original: Pixels, edited: Pixels, keep: Pixels, channels: number, offset: number, width: number, height: number, alignment: ReturnType<typeof imageEditAlignmentAt>, flattened: boolean) {
    // A thin fringe takes its color from nearby solid coverage of the same subject.
    const radius = 5;
    const x = (offset / 4) % width;
    const y = Math.floor(offset / 4 / width);
    const alpha = original[offset + 3];
    // Recovering straight RGB from very low alpha can magnify rounding differences.
    const tolerance = alpha >= OPAQUE_CORE_ALPHA ? 255 : 44 + Math.ceil(128 / alpha);
    let bestRank = Infinity;
    let closestColor = Infinity;
    let source: number | undefined;
    let result: number | undefined;
    for (let row = Math.max(0, y - radius); row <= Math.min(height - 1, y + radius); row++) {
        for (let col = Math.max(0, x - radius); col <= Math.min(width - 1, x + radius); col++) {
            const distance = (row - y) ** 2 + (col - x) ** 2;
            if (distance > radius * radius || distance > bestRank) continue;
            const pixel = row * width + col;
            const candidate = pixel * 4;
            if (original[candidate + 3] !== 255 || keep[(pixel + 1) * channels - 1] === 255) continue;
            const red = Math.abs(original[candidate] - original[offset]);
            const green = Math.abs(original[candidate + 1] - original[offset + 1]);
            const blue = Math.abs(original[candidate + 2] - original[offset + 2]);
            const colorDistance = red * red + green * green + blue * blue;
            if (Math.max(red, green, blue) > tolerance) continue;
            // An opaque return can contain a matte near the contour. Prefer an interior sample.
            const inset = col >= 2 && col + 2 < width && row >= 2 && row + 2 < height
                && original[candidate - 8 + 3] === 255 && original[candidate + 8 + 3] === 255
                && original[candidate - width * 8 + 3] === 255 && original[candidate + width * 8 + 3] === 255;
            const rank = distance + (flattened && !inset ? radius * radius + 1 : 0);
            if (rank > bestRank || (rank === bestRank && colorDistance >= closestColor)) continue;
            const sample = alignment ? alignedEditOffset(candidate, width, alignment) : candidate;
            if (sample === undefined || edited[sample + 3] < OPAQUE_CORE_ALPHA) continue;
            bestRank = rank;
            closestColor = colorDistance;
            source = candidate;
            result = sample;
        }
    }
    if (source !== undefined && result !== undefined && (original[source] !== edited[result] || original[source + 1] !== edited[result + 1] || original[source + 2] !== edited[result + 2])) {
        return result;
    }
}

/** The mask's alpha is the proportion of the original pixel to keep. */
export function mergeImageEditPixels(original: Pixels, edited: Pixels, keep: Pixels, maskChannels: 1 | 4, width: number, height: number, preserveSourceTransparency = false) {
    const feather = softenSelectionEdges(width, height, keep, maskChannels);
    const transparentSource = preserveSourceTransparency && hasTransparency(original);
    const flattenedEdit = transparentSource && !hasTransparency(edited);
    const alignments = transparentSource && !flattenedEdit
        ? findImageEditAlignments(original, edited, keep, maskChannels, width, height)
        : [];
    // Finish the translucent fringe while the opaque source colors are still original.
    for (const translucentPass of transparentSource ? [true, false] : [false]) {
        for (let offset = 0, alpha = maskChannels - 1; offset < original.length; offset += 4, alpha += maskChannels) {
            const strength = Math.max(keep[alpha], feather?.[offset / 4] ?? 0);
            if (strength === 255) continue;
            const originalAlpha = original[offset + 3];
            if (preserveSourceTransparency && (originalAlpha === 0 || translucentPass !== (originalAlpha < 255))) continue;
            const alignment = imageEditAlignmentAt(offset, width, alignments);
            const alignedOffset = alignedEditOffset(offset, width, alignment);
            const keepTranslucentColors = flattenedEdit || (alignment && (alignedOffset === undefined || originalAlpha < OPAQUE_CORE_ALPHA));
            let editOffset = alignedOffset ?? offset;
            if (translucentPass && (flattenedEdit || alignment || edited[editOffset + 3] === 0)) {
                // Keep the original shadow where no nearby subject color can be recovered.
                const edgeOffset = editedEdgeColor(original, edited, keep, maskChannels, offset, width, height, alignment, flattenedEdit);
                if (edgeOffset !== undefined) editOffset = edgeOffset;
                else if (keepTranslucentColors) continue;
            }
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
}

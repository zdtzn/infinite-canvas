type Pixels = Uint8Array | Uint8ClampedArray;

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
export function mergeImageEditPixels(original: Pixels, edited: Pixels, keep: Pixels, maskChannels: 1 | 4, width: number, height: number) {
    const feather = softenSelectionEdges(width, height, keep, maskChannels);
    for (let offset = 0, alpha = maskChannels - 1; offset < original.length; offset += 4, alpha += maskChannels) {
        const strength = Math.max(keep[alpha], feather?.[offset / 4] ?? 0);
        if (strength === 255) continue;
        if (strength === 0) {
            original[offset] = edited[offset];
            original[offset + 1] = edited[offset + 1];
            original[offset + 2] = edited[offset + 2];
            original[offset + 3] = edited[offset + 3];
            continue;
        }

        const before = original[offset + 3] * strength;
        const after = edited[offset + 3] * (255 - strength);
        const alphaSum = before + after;
        for (let channel = 0; channel < 3; channel++) {
            const index = offset + channel;
            original[index] = alphaSum ? Math.round((original[index] * before + edited[index] * after) / alphaSum) : 0;
        }
        original[offset + 3] = Math.round(alphaSum / 255);
    }
}

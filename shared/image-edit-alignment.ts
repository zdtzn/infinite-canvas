type Pixels = Uint8Array | Uint8ClampedArray;
type Bounds = { left: number; top: number; right: number; bottom: number };
type Alignment = { selection: Bounds; source: Bounds; result: Bounds };

// Work with the opaque core to avoid matching a drop shadow or an antialiased fringe.
export const OPAQUE_CORE_ALPHA = 240;

function selectedWindows(keep: Pixels, channels: number, width: number, height: number) {
    const columns = new Uint8Array(width);
    const rows = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (keep[(y * width + x + 1) * channels - 1] !== 255) columns[x] = rows[y] = 1;
        }
    }
    const intervals = (occupied: Uint8Array) => {
        const ranges: Array<[number, number]> = [];
        for (let start = 0; start < occupied.length;) {
            if (!occupied[start]) { start++; continue; }
            let end = start + 1;
            while (occupied[end]) end++;
            ranges.push([start, end]);
            start = end;
        }
        return ranges;
    };
    const horizontal = intervals(columns);
    const vertical = intervals(rows);
    if (!horizontal.length) return [];
    return horizontal.length >= vertical.length
        ? horizontal.map(([left, right]) => ({ left, right, top: vertical[0][0], bottom: vertical.at(-1)![1] }))
        : vertical.map(([top, bottom]) => ({ top, bottom, left: horizontal[0][0], right: horizontal.at(-1)![1] }));
}

function pixelBounds(width: number, window: Bounds, includes: (pixel: number) => boolean) {
    let left = window.right, top = window.bottom, right = window.left, bottom = window.top;
    for (let y = window.top; y < window.bottom; y++) {
        for (let x = window.left; x < window.right; x++) {
            if (!includes(y * width + x)) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = y + 1;
        }
    }
    if (left >= right) return undefined;
    return { left, top, right, bottom };
}

function opaqueBounds(pixels: Pixels, width: number, window: Bounds) {
    return pixelBounds(width, window, (pixel) => pixels[pixel * 4 + 3] >= OPAQUE_CORE_ALPHA);
}

function expand(bounds: Bounds, x: number, y: number, width: number, height: number): Bounds {
    return {
        left: Math.max(0, bounds.left - x), top: Math.max(0, bounds.top - y),
        right: Math.min(width, bounds.right + x), bottom: Math.min(height, bounds.bottom + y),
    };
}

function inside(bounds: Bounds, x: number, y: number) {
    return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
}

function mappedOffset(x: number, y: number, width: number, { source, result }: Alignment) {
    const mappedX = result.left + Math.floor((x - source.left + .5) * (result.right - result.left) / (source.right - source.left));
    const mappedY = result.top + Math.floor((y - source.top + .5) * (result.bottom - result.top) / (source.bottom - source.top));
    return (mappedY * width + mappedX) * 4;
}

function matchSubject(original: Pixels, edited: Pixels, keep: Pixels, channels: number, width: number, alignment: Alignment) {
    const { source } = alignment;
    let currentMatch = 0, currentUnion = 0, alignedMatch = 0, alignedUnion = 0;
    for (let y = source.top; y < source.bottom; y++) {
        for (let x = source.left; x < source.right; x++) {
            const pixel = y * width + x;
            const inSource = original[pixel * 4 + 3] >= OPAQUE_CORE_ALPHA;
            if (inSource && keep[(pixel + 1) * channels - 1] === 255) return undefined;
            const inResult = edited[pixel * 4 + 3] >= OPAQUE_CORE_ALPHA;
            const inAlignedResult = edited[mappedOffset(x, y, width, alignment) + 3] >= OPAQUE_CORE_ALPHA;
            currentMatch += Number(inSource && inResult);
            currentUnion += Number(inSource || inResult);
            alignedMatch += Number(inSource && inAlignedResult);
            alignedUnion += Number(inSource || inAlignedResult);
        }
    }
    const currentOverlap = currentMatch / currentUnion;
    const alignedOverlap = alignedMatch / alignedUnion;
    if (alignedOverlap >= .9 && alignedOverlap - currentOverlap >= .08) return alignment;
    if (currentOverlap >= .9) return { ...alignment, result: source };
}

/** Match a fully selected silhouette and correct its position or size when necessary. */
export function findImageEditAlignments(original: Pixels, edited: Pixels, keep: Pixels, channels: 1 | 4, width: number, height: number) {
    const matches: Alignment[] = [];
    for (const strip of selectedWindows(keep, channels, width, height)) {
        const window = pixelBounds(width, strip, (pixel) => keep[(pixel + 1) * channels - 1] !== 255);
        if (!window) continue;
        const source = opaqueBounds(original, width, expand(window, 1, 1, width, height));
        if (!source || !inside(window, source.left, source.top) || !inside(window, source.right - 1, source.bottom - 1)) continue;
        const w = source.right - source.left;
        const h = source.bottom - source.top;
        if (w < 8 || h < 8) continue;
        const result = opaqueBounds(edited, width, expand(source, Math.ceil(w / 3), Math.ceil(h / 3), width, height));
        if (!result) continue;
        const scaleX = (result.right - result.left) / w;
        const scaleY = (result.bottom - result.top) / h;
        if (scaleX < .75 || scaleX > 4 / 3 || scaleY < .75 || scaleY > 4 / 3) continue;
        const match = matchSubject(original, edited, keep, channels, width, { selection: window, source, result });
        if (match) matches.push(match);
    }
    return matches;
}

export function imageEditAlignmentAt(offset: number, width: number, matches: Alignment[]) {
    if (!matches.length) return undefined;
    const x = offset / 4 % width;
    const y = Math.floor(offset / 4 / width);
    return matches.find(({ selection }) => inside(selection, x, y));
}

export function alignedEditOffset(offset: number, width: number, alignment: Alignment | undefined) {
    if (!alignment) return undefined;
    const x = offset / 4 % width;
    const y = Math.floor(offset / 4 / width);
    if (inside(alignment.source, x, y)) return mappedOffset(x, y, width, alignment);
}

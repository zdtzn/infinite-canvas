/** Row offsets include the following gap; the final grid height excludes it. */
export function promptRowOffsets(count: number, estimate: number, gap: number, measured: ReadonlyMap<number, number>) {
    const offsets = [0];
    for (let row = 0; row < count; row++) offsets.push(offsets[row] + (measured.get(row) ?? estimate) + gap);
    return offsets;
}

export function promptWindowRange(offsets: number[], top: number, viewport: number, overscan = 2) {
    const count = offsets.length - 1;
    if (!count) return { start: 0, end: 0 };
    const rowAt = (position: number) => {
        let low = 0;
        let high = count;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (offsets[middle + 1] <= position) low = middle + 1;
            else high = middle;
        }
        return Math.min(low, count - 1);
    };
    return {
        start: Math.max(0, rowAt(top) - overscan),
        end: Math.min(count, rowAt(top + Math.max(0, viewport)) + 1 + overscan),
    };
}

/** Both rectangles are viewport coordinates; account for the scroller's border. */
export function promptGridScrollTop(scrollTop: number, containerTop: number, clientTop: number, gridTop: number) {
    const gridOffset = gridTop - containerTop - clientTop + scrollTop;
    return scrollTop - gridOffset;
}

export function promptWindowRows(start: number, end: number, focusedRow: number | null, count: number) {
    const rows = Array.from({ length: end - start }, (_, index) => start + index);
    if (focusedRow !== null && focusedRow >= 0 && focusedRow < count && (focusedRow < start || focusedRow >= end)) rows.push(focusedRow);
    return rows.sort((a, b) => a - b);
}

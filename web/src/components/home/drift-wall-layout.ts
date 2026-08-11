export function clampDriftWallColumns(requestedColumns: number, itemCount: number) {
    const normalizedColumns = Math.max(1, Math.floor(requestedColumns));
    return itemCount > 0 ? Math.min(normalizedColumns, itemCount) : normalizedColumns;
}

export function distributeDriftWallItems<T>(items: T[], columns: number) {
    const columnCount = clampDriftWallColumns(columns, items.length);
    const distributed = Array.from({ length: columnCount }, () => [] as T[]);

    items.forEach((item, index) => {
        distributed[index % columnCount].push(item);
    });

    return distributed;
}

export function driftWallCopyCount(columnLength: number, tileUnitHeight: number, containerHeight: number) {
    const copyHeight = Math.max(tileUnitHeight, columnLength * tileUnitHeight);
    const copies = Math.max(2, Math.ceil((Math.max(containerHeight, tileUnitHeight) * 1.7) / copyHeight) + 1);
    return { copies, copyHeight };
}

export function driftWallColumnFactor(index: number, variance: number) {
    const normalizedVariance = Math.min(1, Math.max(0, variance));
    const pseudo = ((index * 0.6180339887 + 0.35) % 1) * 2 - 1;
    return 1 + normalizedVariance * pseudo;
}

type DriftWallPoint = { x: number; y: number };
type DriftWallBounds = { left: number; right: number; top: number; bottom: number };

export function resolveDriftWallHoverId({
    activeId,
    candidateId,
    point,
    activeBounds,
    margin = 8,
}: {
    activeId: string | null;
    candidateId: string | null;
    point: DriftWallPoint;
    activeBounds: DriftWallBounds | null;
    margin?: number;
}) {
    if (activeId && activeBounds) {
        const insideStableBounds = point.x >= activeBounds.left - margin && point.x <= activeBounds.right + margin && point.y >= activeBounds.top - margin && point.y <= activeBounds.bottom + margin;
        if (insideStableBounds) return activeId;
    }

    return candidateId;
}

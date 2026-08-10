import { expect, test } from "bun:test";

import { distributeDriftWallItems, driftWallColumnFactor, driftWallCopyCount } from "./drift-wall-layout";

test("distributes wall items across columns without changing their identity", () => {
    const items = Array.from({ length: 8 }, (_, index) => index);

    expect(distributeDriftWallItems(items, 3)).toEqual([
        [0, 3, 6],
        [1, 4, 7],
        [2, 5],
    ]);
});

test("limits columns to the available item count", () => {
    expect(distributeDriftWallItems(["one", "two"], 5)).toEqual([["one"], ["two"]]);
});

test("creates enough repeated track content to cover the viewport", () => {
    expect(driftWallCopyCount(3, 166, 620)).toEqual({ copyHeight: 498, copies: 4 });
});

test("keeps column variance within the requested range", () => {
    const factor = driftWallColumnFactor(4, 0.32);
    expect(factor).toBeGreaterThanOrEqual(0.68);
    expect(factor).toBeLessThanOrEqual(1.32);
});

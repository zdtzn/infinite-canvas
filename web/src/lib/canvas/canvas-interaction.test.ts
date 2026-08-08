import { expect, test } from "bun:test";

import { shouldDeselectAfterCanvasPan, shouldStartCanvasPan } from "./canvas-interaction";

test("allows Space to temporarily pan from a node without changing normal selection behavior", () => {
    expect(shouldStartCanvasPan({ button: 0, isBackgroundClick: false, isSpacePressed: true })).toBe(true);
    expect(shouldStartCanvasPan({ button: 0, isBackgroundClick: false, isSpacePressed: false })).toBe(false);
    expect(shouldStartCanvasPan({ button: 0, isBackgroundClick: true, isSpacePressed: false })).toBe(true);
});

test("does not clear a node selection after a no-op temporary pan started on a node", () => {
    expect(shouldDeselectAfterCanvasPan({ hasMoved: false, startedOnBackground: false })).toBe(false);
    expect(shouldDeselectAfterCanvasPan({ hasMoved: false, startedOnBackground: true })).toBe(true);
    expect(shouldDeselectAfterCanvasPan({ hasMoved: true, startedOnBackground: true })).toBe(false);
});

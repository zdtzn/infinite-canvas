import { expect, test } from "bun:test";

import { collectMovableCanvasNodeIds, shouldDeselectAfterCanvasPan, shouldStartCanvasPan } from "./canvas-interaction";

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

test("does not move locked batch or group children indirectly", () => {
    const nodes = [
        { id: "group", type: "group", title: "组", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} },
        { id: "free-child", type: "image", title: "可移动", position: { x: 0, y: 0 }, width: 40, height: 40, metadata: { groupId: "group" } },
        { id: "locked-child", type: "image", title: "已锁定", position: { x: 0, y: 0 }, width: 40, height: 40, metadata: { groupId: "group", locked: true } },
        { id: "batch-root", type: "image", title: "批次", position: { x: 0, y: 0 }, width: 40, height: 40, metadata: { batchChildIds: ["free-batch", "locked-batch"] } },
        { id: "free-batch", type: "image", title: "批次子图", position: { x: 0, y: 0 }, width: 40, height: 40, metadata: {} },
        { id: "locked-batch", type: "image", title: "锁定子图", position: { x: 0, y: 0 }, width: 40, height: 40, metadata: { locked: true } },
    ];

    expect(collectMovableCanvasNodeIds(nodes, ["group", "batch-root"])).toEqual(new Set(["group", "free-child", "batch-root", "free-batch"]));
});

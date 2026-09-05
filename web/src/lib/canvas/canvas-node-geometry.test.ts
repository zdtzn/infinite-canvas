import { expect, test } from "bun:test";
import { isHiddenBatchChild } from "./canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("indexed batch visibility is identical for collapsed, expanded and missing roots", () => {
    const root: CanvasNodeData = { id: "root", title: "Root", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { imageBatchExpanded: false } };
    const child = { ...root, id: "child", metadata: { batchRootId: "root" } };
    const missing = { ...child, id: "orphan", metadata: { batchRootId: "missing" } };
    for (const expanded of [true, false]) {
        root.metadata!.imageBatchExpanded = expanded;
        const nodes = [root, child, missing];
        const map = new Map(nodes.map((node) => [node.id, node]));
        for (const collapsing of [undefined, new Set(["root"])]) {
            for (const node of nodes) expect(isHiddenBatchChild(node, nodes, collapsing, map)).toBe(isHiddenBatchChild(node, nodes, collapsing));
        }
    }
});

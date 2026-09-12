import { expect, test } from "bun:test";
import { applyGroupSelection, applyUngroupSelection, canGroupSelectedNodes, canUngroupSelectedNodes, getGroupWrapRect, isHiddenBatchChild } from "./canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const makeNode = (id: string, groupId?: string, locked = false): CanvasNodeData => ({ id, title: id, type: CanvasNodeType.Text, position: { x: 10, y: 20 }, width: 100, height: 80, metadata: { groupId, locked } });
const makeGroup = (id: string, locked = false): CanvasNodeData => ({ ...makeNode(id, undefined, locked), type: CanvasNodeType.Group });

test("grouping preserves unrelated empty groups, positions and member connections", () => {
    const nodes = [makeGroup("empty"), makeGroup("old"), makeNode("a", "old"), makeNode("b")];
    const connections = [{ id: "edge", fromNodeId: "a", toNodeId: "b" }];
    const result = applyGroupSelection(new Set(["a", "b"]), nodes, connections, makeGroup("new"))!;
    expect(result.nodes.map((n) => n.id)).toEqual(["new", "empty", "a", "b"]);
    expect(result.connections).toEqual(connections);
    expect(result.nodes.find((n) => n.id === "a")?.position).toEqual(nodes[2].position);
    expect(nodes[2].metadata?.groupId).toBe("old");
    expect(result.selectedIds).toEqual(["new"]);
});

test("grouping selected groups leaves locked members and their original group intact", () => {
    const nodes = [makeGroup("old"), makeNode("locked", "old", true), makeNode("a", "old"), makeNode("b")];
    const result = applyGroupSelection(new Set(["old", "b"]), nodes, [], makeGroup("new"))!;
    expect(result.nodes.find((n) => n.id === "locked")).toBe(nodes[1]);
    expect(result.nodes.find((n) => n.id === "old")).toBe(nodes[0]);
    expect(result.nodes.find((n) => n.id === "a")?.metadata?.groupId).toBe("new");
});

test("ungroup only selected members and remove only groups emptied by the operation", () => {
    const nodes = [makeGroup("empty"), makeGroup("old"), makeNode("a", "old"), makeNode("b", "old")];
    const partial = applyUngroupSelection(new Set(["a"]), nodes, [])!;
    expect(partial.nodes.map((n) => n.id)).toContain("old");
    expect(partial.nodes.find((n) => n.id === "b")?.metadata?.groupId).toBe("old");
    const full = applyUngroupSelection(new Set(["old"]), nodes, [])!;
    expect(full.nodes.map((n) => n.id)).toEqual(["empty", "a", "b"]);
    expect(full.selectedIds).toEqual(["a", "b"]);
});

test("locked nodes and members of locked groups cannot be regrouped or released", () => {
    const nodes = [makeGroup("old", true), makeNode("a", "old"), makeNode("b", undefined, true), makeNode("c")];
    const ids = new Set(nodes.map((n) => n.id));
    expect(canGroupSelectedNodes(ids, nodes)).toBe(false);
    expect(canUngroupSelectedNodes(ids, nodes)).toBe(false);
    expect(applyUngroupSelection(ids, nodes, [])).toBeNull();
});

test("ungroup preserves locked members and connections and supports selected empty groups", () => {
    const nodes = [makeGroup("empty"), makeGroup("old"), makeNode("a", "old", true), makeNode("b", "old")];
    const edges = [{ id: "edge", fromNodeId: "a", toNodeId: "b" }];
    const result = applyUngroupSelection(new Set(["old"]), nodes, edges)!;
    expect(result.nodes.find((n) => n.id === "a")).toBe(nodes[2]);
    expect(result.nodes.map((n) => n.id)).toContain("old");
    expect(result.connections).toEqual(edges);
    expect(applyUngroupSelection(new Set(["empty"]), nodes, edges)!.nodes.map((n) => n.id)).not.toContain("empty");
});

test("group bounds enclose negative coordinates with header space", () => {
    const node = { ...makeNode("a"), position: { x: -100, y: -60 } };
    expect(getGroupWrapRect([node])).toEqual({ x: -124, y: -112, width: 148, height: 156 });
});

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

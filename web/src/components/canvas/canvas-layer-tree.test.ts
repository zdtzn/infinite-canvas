import { expect, test } from "bun:test";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { buildCanvasLayerRows } from "./canvas-layer-tree";

const node = (id: string, groupId?: string, type = CanvasNodeType.Image): CanvasNodeData => ({ id, title: id, type, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId } });
const ids = (rows: ReturnType<typeof buildCanvasLayerRows>) => rows.map((row) => row.node.id);

test("layer list places group members below their group without duplicating nodes", () => {
    const nodes = [node("outside"), node("child", "group"), node("group", undefined, CanvasNodeType.Group)];
    const rows = buildCanvasLayerRows(nodes, nodes, new Set());
    expect(ids(rows)).toEqual(["outside", "group", "child"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1]);
    expect(rows[1].hasChildren).toBe(true);
});

test("collapsing a group hides only its descendants and can be reversed", () => {
    const nodes = [node("group", undefined, CanvasNodeType.Group), node("child", "group"), node("outside")];
    expect(ids(buildCanvasLayerRows(nodes, nodes, new Set(["group"])))).toEqual(["group", "outside"]);
    expect(ids(buildCanvasLayerRows(nodes, nodes, new Set()))).toEqual(["group", "child", "outside"]);
});

test("filtered matches retain their group path and override saved collapsed state", () => {
    const nodes = [node("outer", undefined, CanvasNodeType.Group), node("inner", "outer", CanvasNodeType.Group), node("match", "inner"), node("other", "inner")];
    const rows = buildCanvasLayerRows(nodes, [nodes[2]], new Set(["outer", "inner"]), true);
    expect(ids(rows)).toEqual(["outer", "inner", "match"]);
    expect(rows.every((row) => !row.collapsed)).toBe(true);
    expect(ids(buildCanvasLayerRows(nodes, nodes, new Set(["outer", "inner"])))).toEqual(["outer"]);
});

test("deleted groups and invalid parent types do not hide orphaned nodes", () => {
    const nodes = [node("orphan", "deleted"), node("image"), node("wrong-parent", "image"), node("self", "self", CanvasNodeType.Group)];
    const rows = buildCanvasLayerRows(nodes, nodes, new Set());
    expect(ids(rows)).toEqual(nodes.map((item) => item.id));
    expect(rows.every((row) => row.depth === 0)).toBe(true);
});

test("imported cyclic groups appear once and retain a matching child during search", () => {
    const nodes = [node("a", "b", CanvasNodeType.Group), node("b", "a", CanvasNodeType.Group), node("match", "b")];
    expect(ids(buildCanvasLayerRows(nodes, nodes, new Set()))).toEqual(["a", "b", "match"]);
    expect(ids(buildCanvasLayerRows(nodes, [nodes[2]], new Set(["a"]), true))).toEqual(["a", "b", "match"]);
});

test("layer grouping leaves batch root and child data intact", () => {
    const root = node("batch", "group");
    root.metadata = { ...root.metadata, isBatchRoot: true, batchChildIds: ["result"], jobId: "root-job" };
    const child = node("result", "group");
    child.metadata = { ...child.metadata, batchRootId: root.id, jobId: "result-job", content: "/api/assets/result" };
    const nodes = [child, root, node("group", undefined, CanvasNodeType.Group)];
    const rows = buildCanvasLayerRows(nodes, nodes, new Set());
    expect(ids(rows)).toEqual(["group", "result", "batch"]);
    expect(rows[1].node).toBe(child);
    expect(rows[2].node).toBe(root);
    expect(root.metadata.batchChildIds).toEqual(["result"]);
    expect(child.metadata.jobId).toBe("result-job");
});

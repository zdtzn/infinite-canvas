import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "bun:test";

import { focusViewportForNode, isHiddenBatchChild } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// Replay production visibility and measurement callbacks without application startup or network access.
const source = readFileSync(new URL("./project.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("project.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "InfiniteCanvasPage") as ts.FunctionDeclaration;
const visibleDeclaration = page.body!.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find((declaration) => declaration.name.getText(file) === "visibleNodes")!;
const visibleCallback = (visibleDeclaration.initializer as ts.CallExpression).arguments[0].getText(file);
const measureDeclaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "measureFocusFrame")!;
const run = (code: string, scope: Record<string, unknown>) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    ...scope,
    fetch: () => { throw new Error("External requests prohibited in this fixture"); },
});
const makeNode = (id: string, x = 5000): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x, y: 100 }, width: 500, height: 500, metadata: {} });
const visibleNodes = (nodes: CanvasNodeData[], dialogNodeId: string | null) => run(`(${visibleCallback})();`, {
    nodes, dialogNodeId, nodeById: new Map(nodes.map((node) => [node.id, node])), isHiddenBatchChild,
    collapsingBatchIds: new Set(), visibleBounds: { left: -280, top: -280, right: 4280, bottom: 3160 },
}) as CanvasNodeData[];

test("an open node panel stays measurable after panning its node offscreen", () => {
    const node = makeNode("panel");
    const mounted = visibleNodes([node, makeNode("unrelated")], node.id);
    const nodeElement = { getBoundingClientRect: () => ({ bottom: 225 }), querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 475 }) }) };
    const container = { getBoundingClientRect: () => ({ bottom: 720 }), querySelector: () => mounted.some((item) => item.id === node.id) ? nodeElement : null };
    const frame = run(`${measureDeclaration.getText(file)}; measureFocusFrame(container, "panel");`, {
        container, CSS: { escape: (id: string) => id },
        document: { querySelector: (selector: string) => ({ getBoundingClientRect: () => selector.includes("data-node-toolbar") ? { height: 44 } : { top: 644 } }) },
    });
    const target = focusViewportForNode(node, { width: 1000, height: 720 }, frame);
    const panelBottom = target.y + (node.position.y + node.height) * target.k + 250;
    expect(frame.below).toBe(250);
    expect(panelBottom).toBeLessThanOrEqual(644);
    expect(Array.from(mounted, (item) => item.id)).toEqual([node.id]);
});

test("keeping a panel mounted preserves culling and hidden batch rules", () => {
    const hidden = { ...makeNode("hidden"), metadata: { hidden: true } };
    const root = { ...makeNode("root", 0), metadata: { imageBatchExpanded: false } };
    const child = { ...makeNode("child"), metadata: { batchRootId: root.id } };
    const nodes = [hidden, root, child, makeNode("offscreen")];
    expect(Array.from(visibleNodes(nodes, hidden.id), (node) => node.id)).toEqual([root.id]);
    expect(Array.from(visibleNodes(nodes, child.id), (node) => node.id)).toEqual([root.id]);
    expect(Array.from(visibleNodes(nodes, null), (node) => node.id)).toEqual([root.id]);
});

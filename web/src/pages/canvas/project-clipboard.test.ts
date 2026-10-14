import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "bun:test";

import * as clipboard from "@/lib/canvas/canvas-clipboard";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

test("pasting an image and composer keeps the generated image reference bound to the copy", () => {
    const source = readFileSync(new URL("./project.tsx", import.meta.url), "utf8");
    const file = ts.createSourceFile("project.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const page = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "InfiniteCanvasPage") as ts.FunctionDeclaration;
    const declaration = page.body!.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find((item) => item.name.getText(file) === "pasteCopiedNodes")!;
    const callback = (declaration.initializer as ts.CallExpression).arguments[0].getText(file);
    const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 240, height: 240, metadata: { content: "data:image/png;base64,AA==" } };
    const config: CanvasNodeData = { ...image, id: "config", type: CanvasNodeType.Config, title: "配置", metadata: { composerContent: "请修改 @[node:image]" } };
    let nodes = [config, image];
    let connections: CanvasConnection[] = [{ id: "input", fromNodeId: image.id, toNodeId: config.id }];
    const scope = {
        ...clipboard, CanvasNodeType,
        clipboardRef: { current: { nodes: [...nodes], connections: [...connections] } }, nodesRef: { current: nodes },
        getCanvasCenter: () => ({ x: 0, y: 0 }),
        setNodes: (update: (previous: CanvasNodeData[]) => CanvasNodeData[]) => { nodes = update(nodes); },
        setConnections: (update: (previous: CanvasConnection[]) => CanvasConnection[]) => { connections = update(connections); },
        setSelectedNodeIds: () => undefined, setSelectedConnectionId: () => undefined, setContextMenu: () => undefined, setDialogNodeId: () => undefined,
        fetch: () => { throw new Error("External requests prohibited in this fixture"); },
    };
    vm.runInNewContext(ts.transpileModule(`(${callback})();`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
    const copiedImage = nodes.find((node) => node.id !== image.id && node.type === CanvasNodeType.Image)!;
    const copiedConfig = nodes.find((node) => node.id !== config.id && node.type === CanvasNodeType.Config)!;
    const context = buildNodeGenerationContext(copiedConfig.id, nodes, connections, copiedConfig.metadata!.composerContent!);
    expect(context.prompt).toBe("请修改 图片1");
    expect(context.imageCount).toBe(1);
    expect(context.referenceImages[0].id).toBe(copiedImage.id);
    expect(config.metadata!.composerContent).toBe("请修改 @[node:image]");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { CanvasNode } from "./canvas-node";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

const image: CanvasResourceReference = { id: "image", nodeId: "image", kind: "image", label: "图片1", title: "角色参考", previewUrl: "/original.png", thumbnailUrl: "/thumb.webp", active: true };
const render = (references: CanvasResourceReference[], extra = {}) => renderToStaticMarkup(createElement(CanvasNodeReferenceBar, { nodeId: "target", references, onDisconnect: () => undefined, onStartSelection: () => undefined, ...extra }));

test("reference bar does not mount original image or other media before preview is opened", () => {
    const html = render([image, { ...image, id: "video", nodeId: "video", kind: "video", previewUrl: "/movie.mp4" }, { ...image, id: "audio", nodeId: "audio", kind: "audio", previewUrl: "/audio.mp3" }]);
    expect(html).toContain('data-image-deferred="waiting"');
    expect(html).not.toContain("/original.png");
    expect(html).not.toContain("/movie.mp4");
    expect(html).not.toContain("/audio.mp3");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="预览图片1：角色参考"');
});

test("group references have one explicit whole-group removal, while direct references remain separate", () => {
    const html = render([{ ...image, sourceNodeId: "group", sourceTitle: "角色素材" }, { ...image, id: "second", nodeId: "second", label: "图片2", sourceNodeId: "group", sourceTitle: "角色素材" }, { ...image, id: "direct", nodeId: "direct", label: "图片3" }]);
    expect(html.match(/aria-label="移除整组「角色素材」引用"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="移除图片1引用"');
    expect(html).not.toContain('aria-label="移除图片2引用"');
    expect(html).toContain('aria-label="移除图片3引用"');
    expect(html).toContain("来自「角色素材」");
});

test("current image is disclosed as automatic input and is not removable", () => {
    const html = render([], { currentImage: { ...image, label: "当前图片" } });
    expect(html).toContain("当前图片会一同作为参考");
    expect(html).toContain('aria-label="预览当前图片：角色参考"');
    expect(html).not.toContain('aria-label="移除当前图片引用"');
});

test("empty reference bar still offers selection without inventing a connected resource", () => {
    const html = render([]);
    expect(html).toContain("选择参考");
    expect(html).toContain("选择画布中的图片、文字或分组作为参考");
    expect(html).not.toContain('aria-haspopup="dialog"');
});

test("groups expose only the source connection handle and reference selection hides node controls", () => {
    const node: CanvasNodeData = { id: "group", type: CanvasNodeType.Group, title: "分组", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} };
    const props = { data: node, scale: 1, isSelected: true, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false, onPointerDown: () => undefined, onHoverStart: () => undefined, onHoverEnd: () => undefined, onConnectStart: () => undefined, onResize: () => undefined, onContentChange: () => undefined, onTitleChange: () => undefined, onContextMenu: () => undefined };
    const html = renderToStaticMarkup(createElement(CanvasNode, props));
    expect(html).toContain("-right-6");
    expect(html).not.toContain("-left-6");
    const selection = renderToStaticMarkup(createElement(CanvasNode, { ...props, isSelectingReferences: true }));
    expect(selection).not.toContain("-right-6");
    expect(selection).not.toContain("cursor-nwse-resize");
});

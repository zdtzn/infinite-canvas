import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
import { readCanvasSidePanelPreference, useCanvasSidePanelStore, writeCanvasSidePanelPreference } from "@/stores/use-canvas-side-panel-store";
import { CanvasNodeType } from "@/types/canvas";
import { CanvasNodesTab } from "./canvas-side-panel";

test("selected canvas nodes do not expose an embedded Ask Dao shortcut", () => {
    const html = renderToStaticMarkup(
        createElement(CanvasNodesTab, {
            nodes: [],
            selectedNodeIds: new Set(["selected-node"]),
            onFocusNode: () => undefined,
            onPreviewNode: () => undefined,
            theme: canvasThemes.light,
        }),
    );

    expect(html).not.toContain("问道台");
});

test("canvas side panel preferences tolerate unavailable local storage", () => {
    const blockedStorage = {
        getItem: () => {
            throw new Error("storage blocked");
        },
        setItem: () => {
            throw new Error("storage blocked");
        },
    };

    expect(readCanvasSidePanelPreference(undefined, "width")).toBeNull();
    expect(readCanvasSidePanelPreference(blockedStorage, "width")).toBeNull();
    expect(() => writeCanvasSidePanelPreference(blockedStorage, "width", "320")).not.toThrow();
});

test("node list retains image preview and type filtering beside the grid switch", () => {
    const html = renderToStaticMarkup(createElement(CanvasNodesTab, {
        nodes: [{ id: "image", type: CanvasNodeType.Image, title: "云端图片", position: { x: 0, y: 0 }, width: 120, height: 100, metadata: { content: "/api/assets/original", thumbnailUrl: "/api/assets/thumbnail" } }],
        selectedNodeIds: new Set<string>(),
        onFocusNode: () => undefined,
        onPreviewNode: () => undefined,
        theme: canvasThemes.dark,
    }));

    expect(html).toContain("云端图片");
    expect(html).toContain('aria-label="切换为网格"');
    expect(html).toContain('aria-label="筛选节点类型"');
    expect(html).toContain('aria-label="放大预览"');
    expect(html).toContain('data-image-deferred="waiting"');
});

test("grid preference persists and still switches when browser storage is blocked", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const previousMode = useCanvasSidePanelStore.getState().nodeViewMode;
    const saved: [string, string][] = [];
    try {
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key: string, value: string) => saved.push([key, value]) } });
        useCanvasSidePanelStore.getState().setNodeViewMode("grid");
        expect(saved).toEqual([["canvas-side-panel-node-view", "grid"]]);
        expect(useCanvasSidePanelStore.getState().nodeViewMode).toBe("grid");

        Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("storage blocked"); } });
        expect(() => useCanvasSidePanelStore.getState().setNodeViewMode("list")).not.toThrow();
        expect(useCanvasSidePanelStore.getState().nodeViewMode).toBe("list");
    } finally {
        if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
        else Reflect.deleteProperty(globalThis, "localStorage");
        useCanvasSidePanelStore.setState({ nodeViewMode: previousMode });
    }
});

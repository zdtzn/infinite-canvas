import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
import { persistCanvasSidePanelWidth, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
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
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });

    try {
        expect(() => useCanvasSidePanelStore.getState().openPanel()).not.toThrow();
        expect(() => persistCanvasSidePanelWidth(320)).not.toThrow();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
});

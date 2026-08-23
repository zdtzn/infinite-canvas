import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
import { readCanvasSidePanelPreference, writeCanvasSidePanelPreference } from "@/stores/use-canvas-side-panel-store";
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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
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

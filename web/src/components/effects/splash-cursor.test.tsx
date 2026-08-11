import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SplashCursor } from "./splash-cursor";

test("splash cursor renders a non-interactive fluid canvas layer", () => {
    const html = renderToStaticMarkup(createElement(SplashCursor, { className: "is-canvas-workspace" }));

    assert.match(html, /splash-cursor-layer is-canvas-workspace/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /<canvas/);
});

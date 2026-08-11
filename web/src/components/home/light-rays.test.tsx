import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getLightRayAnchor, hexToRgb, LightRays } from "./light-rays";

test("light rays convert configured colors and positions into shader values", () => {
    assert.deepEqual(hexToRgb("#00ffff"), [0, 1, 1]);
    assert.deepEqual(hexToRgb("invalid"), [1, 1, 1]);
    assert.deepEqual(getLightRayAnchor("top-right", 1000, 500), { anchor: [1000, -100], dir: [0, 1] });
});

test("light rays render as a non-interactive homepage environment layer", () => {
    const html = renderToStaticMarkup(createElement(LightRays, { raysOrigin: "top-left", className: "homepage-light-rays" }));

    assert.match(html, /light-rays-container homepage-light-rays/);
    assert.match(html, /aria-hidden="true"/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SideRays, sideRaysAnimationDuration } from "./side-rays";

test("side rays keep animation duration bounded", () => {
    assert.equal(sideRaysAnimationDuration(0), 72);
    assert.equal(sideRaysAnimationDuration(10), 14);
});

test("side rays render as a CSS environment layer without WebGL", () => {
    const html = renderToStaticMarkup(createElement(SideRays, { origin: "top-left", speed: 2, className: "is-imperial" }));

    assert.match(html, /side-rays--top-left/);
    assert.match(html, /side-rays__beam--three/);
    assert.match(html, /--side-rays-duration:16s/);
    assert.doesNotMatch(html, /<canvas/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { clearFluidContextForReuse, SplashCursor } from "./splash-cursor";

test("splash cursor renders a non-interactive fluid canvas layer", () => {
    const html = renderToStaticMarkup(createElement(SplashCursor, { className: "is-canvas-workspace" }));

    assert.match(html, /splash-cursor-layer is-canvas-workspace/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /<canvas/);
});

test("splash cursor cleanup preserves a reusable WebGL context", () => {
    const calls: Array<unknown[]> = [];
    const gl = {
        FRAMEBUFFER: 0x8d40,
        COLOR_BUFFER_BIT: 0x4000,
        isContextLost: () => false,
        bindFramebuffer: (...args: unknown[]) => calls.push(["bindFramebuffer", ...args]),
        viewport: (...args: unknown[]) => calls.push(["viewport", ...args]),
        clearColor: (...args: unknown[]) => calls.push(["clearColor", ...args]),
        clear: (...args: unknown[]) => calls.push(["clear", ...args]),
        getExtension: () => {
            throw new Error("cleanup must not deliberately lose the WebGL context");
        },
    };

    assert.equal(clearFluidContextForReuse(gl, 1280, 720), true);
    assert.deepEqual(calls, [
        ["bindFramebuffer", gl.FRAMEBUFFER, null],
        ["viewport", 0, 0, 1280, 720],
        ["clearColor", 0, 0, 0, 0],
        ["clear", gl.COLOR_BUFFER_BIT],
    ]);
});

test("splash cursor cleanup leaves an already-lost WebGL context untouched", () => {
    let touched = false;
    const gl = {
        FRAMEBUFFER: 0x8d40,
        COLOR_BUFFER_BIT: 0x4000,
        isContextLost: () => true,
        bindFramebuffer: () => {
            touched = true;
        },
        viewport: () => {
            touched = true;
        },
        clearColor: () => {
            touched = true;
        },
        clear: () => {
            touched = true;
        },
    };

    assert.equal(clearFluidContextForReuse(gl, 1280, 720), false);
    assert.equal(touched, false);
});

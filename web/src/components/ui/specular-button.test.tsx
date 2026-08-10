import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SpecularButton } from "./specular-button";

test("specular button preserves native button semantics without a canvas renderer", () => {
    const html = renderToStaticMarkup(
        createElement(
            SpecularButton,
            {
                type: "submit",
                size: "md",
                radius: 8,
                className: "custom-button",
            },
            "起笔 · 新建画布",
        ),
    );

    assert.match(html, /type="submit"/);
    assert.match(html, /specular-button--md/);
    assert.match(html, /custom-button/);
    assert.match(html, /--sb-radius:8px/);
    assert.match(html, /起笔 · 新建画布/);
    assert.doesNotMatch(html, /<canvas/);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { guideSections, searchGuideSections } from "./content";

test("covers the main user-facing Infinite Canvas workflows", () => {
    const ids = new Set(guideSections.map((section) => section.id));
    assert.equal(ids.size, guideSections.length);
    for (const required of ["getting-started", "canvas", "color-alchemy", "image-workbench", "product-lab", "prompts", "assets", "cultivation", "configuration", "task-center", "canvas-agent", "data-and-account", "faq"]) {
        assert.ok(ids.has(required), `missing docs section: ${required}`);
    }
});

test("finds guidance by user language instead of route names only", () => {
    assert.ok(searchGuideSections("入藏卷阁").some((section) => section.id === "image-workbench"));
    assert.ok(searchGuideSections("上游 400").some((section) => section.id === "faq"));
    assert.ok(searchGuideSections("管理员 密钥").some((section) => section.id === "configuration"));
    assert.ok(searchGuideSections("借色 HSL").some((section) => section.id === "color-alchemy"));
});

test("keeps user-facing actions on internal routes", () => {
    for (const section of guideSections) {
        if (section.path) assert.match(section.path, /^\//);
    }
});

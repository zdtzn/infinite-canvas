import assert from "node:assert/strict";
import { test } from "node:test";

import { guideSections, searchGuideSections } from "./content";

test("covers the main user-facing Infinite Canvas workflows", () => {
    const ids = new Set(guideSections.map((section) => section.id));
    assert.equal(ids.size, guideSections.length);
    for (const required of ["getting-started", "canvas", "color-alchemy", "image-workbench", "product-lab", "prompts", "assets", "cultivation", "configuration", "admin-console", "task-center", "canvas-agent", "data-and-account", "faq"]) {
        assert.ok(ids.has(required), `missing docs section: ${required}`);
    }
});

test("finds guidance by user language instead of route names only", () => {
    assert.ok(searchGuideSections("入藏卷阁").some((section) => section.id === "image-workbench"));
    assert.ok(searchGuideSections("上游 400").some((section) => section.id === "faq"));
    assert.ok(searchGuideSections("管理员 密钥").some((section) => section.id === "configuration"));
    assert.ok(searchGuideSections("借色 HSL").some((section) => section.id === "color-alchemy"));
    assert.ok(searchGuideSections("太古遗迹 原图").some((section) => section.id === "image-workbench"));
    assert.ok(searchGuideSections("一键详情套装 核心三图").some((section) => section.id === "product-lab"));
    assert.ok(searchGuideSections("切分图片 生成子节点").some((section) => section.id === "canvas"));
    assert.ok(searchGuideSections("主题 单选").some((section) => section.id === "prompts"));
    assert.ok(searchGuideSections("渠道健康 备份").some((section) => section.id === "admin-console"));
});

test("uses current product language instead of retired labels", () => {
    const text = JSON.stringify(guideSections);
    assert.match(text, /太古遗迹/);
    assert.match(text, /生成进度/);
    assert.doesNotMatch(text, /历史入口可回看近期任务/);
});

test("keeps user-facing actions on internal routes", () => {
    for (const section of guideSections) {
        if (section.path) assert.match(section.path, /^\//);
    }
});

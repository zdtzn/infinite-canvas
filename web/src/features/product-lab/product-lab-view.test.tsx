import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductOutputGrid, ProductRealmHeader, ProductWorkflowSteps } from "./product-lab-view";

test("renders a restrained realm identity header for normal users", () => {
    const html = renderToStaticMarkup(
        createElement(ProductRealmHeader, {
            realmName: "斗师",
            stageName: "三星",
            title: "商品灵韵已可解析。",
            description: "可以识别商品并凝练基础卖点。",
            imperial: false,
        }),
    );

    assert.match(html, /商品灵韵已可解析/);
    assert.match(html, /斗师 · 三星/);
    assert.doesNotMatch(html, /帝境商品领域/);
});

test("adds a quiet Dou Emperor identity treatment without game-style copy", () => {
    const html = renderToStaticMarkup(
        createElement(ProductRealmHeader, {
            realmName: "斗帝",
            stageName: "斗帝",
            title: "恭迎斗帝归来。",
            description: "商品万象，皆可化为画卷。",
            imperial: true,
        }),
    );

    assert.match(html, /帝境商品领域/);
    assert.match(html, /商品万象，皆可化为画卷/);
    assert.doesNotMatch(html, /VIP|战力|奖励/);
});

test("keeps unavailable outputs visible with a clear cultivation reason", () => {
    const html = renderToStaticMarkup(
        createElement(ProductOutputGrid, {
            outputs: [
                { kind: "main_image", label: "商品主图", capability: "product.main_image", description: "首图", requiresAnalysis: false, available: true, reason: "" },
                {
                    kind: "detail_page",
                    label: "详情页",
                    capability: "product.detail_page",
                    description: "分页详情",
                    requiresAnalysis: true,
                    available: false,
                    reason: "当前境界尚不足以开启此项商品法则。继续修炼即可掌握。",
                },
            ],
            selectedKinds: ["main_image"],
            onToggle: () => undefined,
        }),
    );

    assert.match(html, /商品主图/);
    assert.match(html, /详情页/);
    assert.match(html, /继续修炼即可掌握/);
});

test("shows a clear three-step workflow and marks the current action", () => {
    const html = renderToStaticMarkup(
        createElement(ProductWorkflowSteps, {
            currentStep: "plan",
            availableSteps: ["source", "plan"],
            onSelect: () => undefined,
        }),
    );

    assert.match(html, /上传商品/);
    assert.match(html, /确认方案/);
    assert.match(html, /生成与挑选/);
    assert.match(html, /aria-current="step"[^>]*>.*确认方案/s);
    assert.match(html, /disabled=""[^>]*>.*生成与挑选/s);
});

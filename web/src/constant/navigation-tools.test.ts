import assert from "node:assert/strict";
import { test } from "node:test";

import { navigationSceneNames, navigationTools, primaryNavigationTools, secondaryNavigationTools } from "./navigation-tools";

test("keeps the core creation workspaces available in the primary navigation", () => {
    assert.deepEqual(
        primaryNavigationTools.map((tool) => tool.slug),
        ["canvas", "image", "product-lab", "assets", "color-alchemy"],
    );
});

test("keeps secondary navigation separate from the core work routes", () => {
    assert.ok(secondaryNavigationTools.every((tool) => !["canvas", "image", "product-lab", "assets", "color-alchemy"].includes(tool.slug)));
});

test("exposes Color Alchemy as an independent primary workspace", () => {
    const colorAlchemy = navigationTools.find((tool) => tool.slug === "color-alchemy");
    assert.ok(colorAlchemy);
    assert.equal(colorAlchemy.label, "灵彩调色");
    assert.equal((navigationSceneNames as Record<string, string>)["color-alchemy"], "灵彩");
});

test("keeps the original Dong Fu page as the standalone configuration entry", () => {
    const config = navigationTools.find((tool) => tool.slug === "config");
    assert.ok(config);
    assert.equal(config.label, "配置");
    assert.equal((navigationSceneNames as Record<string, string>).config, "洞府");
});

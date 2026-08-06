import assert from "node:assert/strict";
import { test } from "node:test";

import { navigationSceneNames, navigationTools, primaryNavigationTools, secondaryNavigationTools } from "./navigation-tools";

test("keeps the core creation workspaces available in the primary navigation", () => {
    assert.deepEqual(
        primaryNavigationTools.map((tool) => tool.slug),
        ["canvas", "image", "product-lab", "assets"],
    );
});

test("keeps secondary navigation separate from the core work routes", () => {
    assert.ok(secondaryNavigationTools.every((tool) => !["canvas", "image", "product-lab", "assets"].includes(tool.slug)));
});

test("keeps the original Dong Fu page as the standalone configuration entry", () => {
    const config = navigationTools.find((tool) => tool.slug === "config");
    assert.ok(config);
    assert.equal(config.label, "配置");
    assert.equal((navigationSceneNames as Record<string, string>).config, "洞府");
});

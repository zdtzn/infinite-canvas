import assert from "node:assert/strict";
import { test } from "node:test";

import { primaryNavigationTools, secondaryNavigationTools } from "./navigation-tools";

test("keeps the core creation workspaces available in the primary navigation", () => {
    assert.deepEqual(
        primaryNavigationTools.map((tool) => tool.slug),
        ["canvas", "image", "product-lab", "assets"],
    );
});

test("keeps secondary navigation separate from the core work routes", () => {
    assert.ok(secondaryNavigationTools.every((tool) => !["canvas", "image", "product-lab", "assets"].includes(tool.slug)));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { primaryNavigationTools, secondaryNavigationTools } from "./navigation-tools";

test("keeps canvas, image, and assets available in the primary navigation", () => {
    assert.deepEqual(
        primaryNavigationTools.map((tool) => tool.slug),
        ["canvas", "image", "assets"],
    );
});

test("keeps secondary navigation separate from the core work routes", () => {
    assert.ok(secondaryNavigationTools.every((tool) => !["canvas", "image", "assets"].includes(tool.slug)));
});

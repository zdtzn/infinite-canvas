import assert from "node:assert/strict";
import { test } from "node:test";

import { promptSourceCacheKey } from "./prompts";

test("uses the current prompt parser cache version", () => {
    assert.equal(promptSourceCacheKey("source-id"), "prompt-source:v3:source-id");
});

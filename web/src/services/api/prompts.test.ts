import assert from "node:assert/strict";
import { test } from "node:test";

import { promptSourceCacheKey, promptSourceCacheRevision } from "./prompts";

test("uses the current prompt parser cache version", () => {
    assert.equal(promptSourceCacheKey("source-id"), "prompt-source:v2:source-id");
});

test("invalidates only YouMind source caches for HTML content images", () => {
    assert.equal(promptSourceCacheRevision("youmind-gpt-image-2"), "html-content-images-v1");
    assert.equal(promptSourceCacheRevision("youmind-nano-banana-pro"), "html-content-images-v1");
    assert.equal(promptSourceCacheRevision("freestylefly-awesome-gpt-image-2"), "");
});

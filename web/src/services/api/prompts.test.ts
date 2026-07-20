import assert from "node:assert/strict";
import { test } from "node:test";

import { promptSourceCacheKey } from "./prompts";
import { DEFAULT_PROMPT_SOURCES } from "./prompt-source-presets";

test("uses the current prompt parser cache version", () => {
    assert.equal(promptSourceCacheKey("source-id"), "prompt-source:v2:source-id");
});

test("invalidates only YouMind source caches for HTML content images", () => {
    const sources = DEFAULT_PROMPT_SOURCES.filter((source) => source.id.startsWith("youmind-"));

    assert.equal(sources.length, 2);
    assert.ok(sources.every((source) => source.script.includes("html-content-images-v1")));
});

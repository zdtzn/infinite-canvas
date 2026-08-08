import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PROMPT_SOURCES } from "./prompt-source-presets";
import { PROMPT_SOURCE_CACHE_TTL_MS, promptSourceCacheKey, promptSourceCacheRevision, promptSourceCacheState } from "./prompts";

test("uses the current prompt parser cache version", () => {
    assert.equal(promptSourceCacheKey("source-id"), "prompt-source:v2:source-id");
});

test("invalidates only YouMind source caches for HTML content images", () => {
    assert.equal(promptSourceCacheRevision("youmind-gpt-image-2"), "html-content-images-v1");
    assert.equal(promptSourceCacheRevision("youmind-nano-banana-pro"), "html-content-images-v1");
    assert.equal(promptSourceCacheRevision("freestylefly-awesome-gpt-image-2"), "");
});

test("includes Banana Prompt Quicker as a trusted default without removing custom galleries", () => {
    const banana = DEFAULT_PROMPT_SOURCES.find((source) => source.id === "banana-prompt-quicker");
    assert.equal(banana?.trusted, true);
    assert.match(banana?.script || "", /banana-prompt-quicker\.json/);
    assert.ok(DEFAULT_PROMPT_SOURCES.some((source) => source.id === "freestylefly-awesome-gpt-image-2"));
});

test("keeps a valid expired source cache available while a refresh runs in the background", () => {
    const cached = {
        items: [{ id: "prompt-1" }],
        fetchedAt: 1_000,
        signature: "stable-source",
    };

    assert.equal(promptSourceCacheState(cached, "stable-source", 1_000 + PROMPT_SOURCE_CACHE_TTL_MS + 1), "stale");
});

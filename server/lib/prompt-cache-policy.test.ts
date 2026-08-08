import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PROMPT_CACHE_MAX_ENTRIES, promptProxyLane } from "./prompt-cache-policy";

test("keeps enough prompt cache entries for source manifests and cover images", () => {
    assert.ok(DEFAULT_PROMPT_CACHE_MAX_ENTRIES >= 2_000);
});

test("isolates thumbnail transforms from normal prompt resource requests", () => {
    assert.equal(promptProxyLane("/prompt-proxy/thumbnail/?url=https%3A%2F%2Fexample.com%2Fcover.png"), "thumbnail");
    assert.equal(promptProxyLane("/prompt-proxy/raw/example/prompts/main/README.md"), "asset");
});

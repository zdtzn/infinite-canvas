import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PROMPT_SOURCES } from "./prompt-source-presets";
import { PROMPT_SOURCE_CACHE_TTL_MS, buildPromptIndexQuery, promptSourceCacheKey, promptSourceCacheRevision, promptSourceCacheState } from "./prompts";

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

test("includes the attributed GPT-4o image gallery as a trusted source", () => {
    const source = DEFAULT_PROMPT_SOURCES.find((item) => item.id === "jamez-bondos-awesome-gpt4o-images");
    assert.equal(source?.trusted, true);
    assert.equal(source?.githubUrl, "https://github.com/jamez-bondos/awesome-gpt4o-images");
    assert.match(source?.script || "", /README\.md/);
});

test("includes the deduped GPT Image 2 commercial gallery as a trusted source", () => {
    const source = DEFAULT_PROMPT_SOURCES.find((item) => item.id === "evolink-gpt-image-2-commercial");
    assert.equal(source?.name, "GPT Image 2 商业创意精选");
    assert.equal(source?.trusted, true);
    assert.equal(source?.githubUrl, "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts");
    assert.match(source?.script || "", /ecommerce_zh-CN\.md/);
    assert.match(source?.script || "", /ad-creative_zh-CN\.md/);
});

test("keeps a valid expired source cache available while a refresh runs in the background", () => {
    const cached = {
        items: [{ id: "prompt-1" }],
        fetchedAt: 1_000,
        signature: "stable-source",
    };

    assert.equal(promptSourceCacheState(cached, "stable-source", 1_000 + PROMPT_SOURCE_CACHE_TTL_MS + 1), "stale");
});

test("builds a bounded server-side prompt query with source, primary category and pagination", () => {
    const query = buildPromptIndexQuery({
        sourceId: "youmind-gpt-image-2",
        keyword: "商品 主图",
        tag: ["商品商业"],
        category: "全部",
        page: 3,
        pageSize: 30,
    });

    assert.equal(query.get("sourceId"), "youmind-gpt-image-2");
    assert.equal(query.get("keyword"), "商品 主图");
    assert.deepEqual(query.getAll("tag"), ["商品商业"]);
    assert.equal(query.get("page"), "3");
    assert.equal(query.get("pageSize"), "30");
});

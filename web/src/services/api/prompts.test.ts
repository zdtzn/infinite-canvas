import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PROMPT_SOURCES } from "./prompt-source-presets";
import { PROMPT_SOURCE_CACHE_TTL_MS, buildPromptIndexQuery, promptSourceCacheKey, promptSourceCacheRevision, promptSourceCacheState } from "./prompts";
import { getPromptUsage, mergeCrossSourcePrompts, searchLocalPrompts, tokenizePromptKeyword } from "../../../../shared/prompt-library";

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

test("preserves sorting alongside filters and pagination", () => {
    for (const order of ["asc", "desc", "relevance"] as const) {
        const query = buildPromptIndexQuery({ sourceId: "gallery", keyword: "example", tag: ["商品商业"], category: "全部", page: 2, pageSize: 10, order });
        assert.equal(query.get("order"), order);
        assert.equal(query.get("sourceId"), "gallery");
        assert.equal(query.get("keyword"), "example");
        assert.equal(query.get("page"), "2");
        assert.deepEqual(query.getAll("tag"), ["商品商业"]);
    }
    assert.equal(buildPromptIndexQuery({ keyword: "", tag: [], category: "全部", page: 1, pageSize: 20 }).has("order"), false);
    assert.equal(buildPromptIndexQuery({ keyword: "", tag: [], category: "全部", page: 1, pageSize: 20, media: "video" }).get("media"), "video");
});

const example = (sourceId: string, title: string, prompt: string, sourceTags: string[] = []) => ({
    sourceId, title, prompt, category: sourceId, githubUrl: `https://example.test/${sourceId}`, tags: ["商品商业"], sourceTags,
    usage: getPromptUsage({ title, prompt, tags: sourceTags }),
});

test("local results match split literal keywords and prioritize a title match", () => {
    const top = example("one", "商品海报", "以清晰的版式展示产品。");
    const body = example("two", "设计灵感", "用醒目的配色做一张商品宣传海报。");
    const literal = example("one", "写入百分号", "保留 100% 和 price_label。");
    const filter = { sourceId: "", category: "全部", tags: [], order: "relevance" as const };
    assert.deepEqual(searchLocalPrompts([top, body, literal], { ...filter, terms: tokenizePromptKeyword("商品　海报") }), [top, body]);
    assert.deepEqual(searchLocalPrompts([top, body, literal], { ...filter, terms: tokenizePromptKeyword("% _") }), [literal]);
});

test("exact cross-source matches retain links and requirements without removing distinct text", () => {
    const original = example("one", "商品海报", "相同正文");
    const same = example("two", "广告模板", "相同正文", ["需要参考图"]);
    const other = example("one", "商品海报", "另一版正文");
    assert.deepEqual(mergeCrossSourcePrompts([original, other]), [original, other]);
    const [merged, distinct] = mergeCrossSourcePrompts([original, other, same]);
    assert.equal(distinct, other);
    assert.deepEqual(merged.sources?.map(({ githubUrl }) => githubUrl), [original.githubUrl, same.githubUrl]);
    assert.equal(merged.usage.requiresReference, true);
    const [titleMatch] = mergeCrossSourcePrompts([original], [same, original]);
    assert.equal(titleMatch.title, original.title);
    assert.deepEqual(titleMatch.sources?.map(({ githubUrl }) => githubUrl), [original.githubUrl, same.githubUrl]);
});

test("library usage treats video metadata and reference requirements as distinct signals", () => {
    assert.deepEqual(getPromptUsage({ title: "城市夜景", prompt: "Use the reference image to match its lights.", tags: ["视频模板 - 电影叙事", "gpt-image-2"] }), { media: "video", requiresReference: true });
    assert.deepEqual(getPromptUsage({ title: "构图灵感", prompt: "Use a high view of the scene.", tags: [] }), { media: "general", requiresReference: false });
});

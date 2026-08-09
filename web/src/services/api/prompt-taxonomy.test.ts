import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyPromptTags, PROMPT_TAXONOMY, sortPromptTaxonomyTags } from "./prompt-taxonomy";

test("reduces noisy source metadata to stable user-facing themes", () => {
    assert.deepEqual(
        classifyPromptTags({
            title: "国风茶具电商主图",
            prompt: "Create a commercial product photography scene with ink wash details.",
            tags: ["gpt-image-2", "freestylefly", "某位作者", "电商设计"],
        }),
        ["商品商业", "国风东方"],
    );
});

test("keeps reference editing discoverable without exposing model tags", () => {
    const tags = classifyPromptTags({
        title: "保持人物特征并替换背景",
        prompt: "Use the reference image for an image edit and cinematic portrait.",
        tags: ["nano-banana-pro", "需要参考图", "community"],
    });

    assert.equal(tags.length, 2);
    assert.ok(tags.includes("图像编辑"));
    assert.ok(tags.includes("人物人像"));
    assert.ok(!tags.includes("nano-banana-pro" as never));
});

test("uses one fallback theme and keeps filters in a stable order", () => {
    assert.deepEqual(classifyPromptTags({ title: "抽象实验", prompt: "unexpected forms", tags: ["author-name"] }), ["创意灵感"]);
    assert.deepEqual(sortPromptTaxonomyTags(["图像编辑", "人物人像", "商品商业"]), ["人物人像", "商品商业", "图像编辑"]);
    assert.equal(PROMPT_TAXONOMY.length, 11);
});

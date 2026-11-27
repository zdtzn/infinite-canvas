import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyPromptTags, PROMPT_TAXONOMY, sortPromptTaxonomyTags } from "./prompt-taxonomy";

test("reduces noisy source metadata to one stable user-facing primary theme", () => {
    assert.deepEqual(
        classifyPromptTags({
            title: "国风茶具电商主图",
            prompt: "Create a commercial product photography scene with ink wash details.",
            tags: ["gpt-image-2", "freestylefly", "某位作者", "电商设计"],
        }),
        ["商品商业"],
    );
});

test("keeps reference editing discoverable without exposing model tags", () => {
    const tags = classifyPromptTags({
        title: "保持人物特征并替换背景",
        prompt: "Use the reference image for an image edit and cinematic portrait.",
        tags: ["nano-banana-pro", "需要参考图", "community"],
    });

    assert.deepEqual(tags, ["图像编辑"]);
    assert.ok(!tags.includes("nano-banana-pro" as never));
});

test("uses titles and useful source categories ahead of reference requirements and incidental imagery", () => {
    const cases = [
        { title: "名画人物麦片广告", prompt: "Reference image for a cereal campaign. An illustrated portrait of a shopkeeper in a forest.", tags: ["广告设计", "需要参考图"], expected: "商品商业" },
        { title: "可爱珐琅别针", prompt: "Use the reference image in the catalog. In the background, show trees and mountains.", tags: ["产品展示图", "需要参考图"], expected: "商品商业" },
        { title: "手绘草图转专业流程图", prompt: "Follow the reference image and use clean lines.", tags: ["需要参考图"], expected: "平面设计" },
        { title: "Q版角色LINE风格表情包生成", prompt: "Use the reference image to capture the person's look.", tags: ["需要参考图"], expected: "动漫插画" },
        { title: "自己画自己的自画像", prompt: "A building, mountains, an ocean and trees are visible in the background. Avoid logo and typography.", tags: ["需要参考图"], expected: "人物人像" },
    ];
    for (const { expected, ...input } of cases) assert.deepEqual(classifyPromptTags(input), [expected], input.title);
});

test("keeps concrete editing tasks in the editing theme", () => {
    for (const title of ["人像换背景", "给商品抠图", "提取主体并放置透明背景", "提高分辨率", "人物姿势参考替换", "漫画页面上色与翻译"]) {
        assert.deepEqual(classifyPromptTags({ title, prompt: "", tags: ["需要参考图"] }), ["图像编辑"], title);
    }
    assert.deepEqual(classifyPromptTags({ title: "练习", prompt: "Replace the background with a forest.", tags: ["需要参考图"] }), ["图像编辑"]);
    assert.deepEqual(classifyPromptTags({ title: "珐琅别针产品展示", prompt: "Replace the background based on the reference image.", tags: ["需要参考图"] }), ["商品商业"]);
});

test("prefers recognized source categories to incidental title terms", () => {
    assert.deepEqual(classifyPromptTags({ title: "动物硅胶腕托", prompt: "", tags: ["产品展示图"] }), ["商品商业"]);
    assert.deepEqual(classifyPromptTags({ title: "定制动漫手办", prompt: "", tags: ["3D/手办/潮玩"] }), ["3D 创意"]);
    assert.deepEqual(classifyPromptTags({ title: "定制动漫手办", prompt: "", tags: ["3D", "手办", "潮玩"] }), ["3D 创意"]);
    assert.deepEqual(classifyPromptTags({ title: "插画促销", prompt: "", tags: ["广告设计"] }), ["商品商业"]);
    assert.deepEqual(classifyPromptTags({ title: "给动物硅胶腕托抠图", prompt: "", tags: ["产品展示图"] }), ["图像编辑"]);
});

test("leaves negative instructions and background decoration out of fallback inference", () => {
    assert.deepEqual(classifyPromptTags({
        title: "光线练习",
        prompt: "A puppy runs on the path. No logo, poster, typography or watermark. In the background show a building and furniture.",
        tags: [],
    }), ["自然风景"]);
    assert.deepEqual(classifyPromptTags({
        title: "光线练习",
        prompt: "一张人物写真，有标志。背景：森林、天空、海洋和植物。避免海报、排版和品牌标志。",
        tags: [],
    }), ["人物人像"]);
    assert.deepEqual(classifyPromptTags({ title: "标志设计", prompt: "", tags: [] }), ["平面设计"]);
    assert.deepEqual(classifyPromptTags({ title: "参考练习", prompt: "Use a reference image.", tags: ["需要参考图", "needs_ref"] }), ["创意灵感"]);
});

test("uses one fallback theme and keeps filters in a stable order", () => {
    assert.deepEqual(classifyPromptTags({ title: "抽象实验", prompt: "unexpected forms", tags: ["author-name"] }), ["创意灵感"]);
    assert.deepEqual(classifyPromptTags({ title: "旧索引记录", prompt: "", tags: ["商品商业"] }), ["商品商业"]);
    assert.deepEqual(classifyPromptTags({ title: "未命名", prompt: "", tags: [], previousTheme: "商品商业" }), ["商品商业"]);
    assert.deepEqual(classifyPromptTags({ title: "室内建筑", prompt: "", tags: [], previousTheme: "摄影写实" }), ["建筑空间"]);
    assert.deepEqual(classifyPromptTags({ title: "可爱珐琅别针", prompt: "A portrait design based on a reference image.", tags: [], previousTheme: "人物人像" }), ["商品商业"]);
    assert.deepEqual(classifyPromptTags({ title: "海报制作", prompt: "", tags: ["商品商业"] }), ["商品商业"]);
    assert.deepEqual(sortPromptTaxonomyTags(["图像编辑", "人物人像", "商品商业"]), ["人物人像", "商品商业", "图像编辑"]);
    assert.equal(PROMPT_TAXONOMY.length, 11);
});

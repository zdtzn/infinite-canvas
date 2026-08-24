import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEvolinkGptImage2CommercialMarkdown, parseJamezBondosAwesomeGpt4oImagesMarkdown, runPromptSource } from "./prompt-source-runtime";

test("extracts an image whose multiline alt text contains escaped brackets", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = "![\\[CORE TASK\\]\nTransform the product...](../data/images/case78.jpg)";
    const [prompt] = await runPromptSource(`
const markdown = ${JSON.stringify(markdown)};
const images = extractImages("https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/docs", markdown);
return [makePrompt({ id: "case-78", title: "Case 78", prompt: "Prompt", coverUrl: images[0] || "" })];
`);

    assert.equal(prompt.coverUrl, "/prompt-proxy/raw/freestylefly/awesome-gpt-image-2/main/data/images/case78.jpg");
});

test("ignores badge images and uses HTML content images", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = `
![Language-EN](https://img.shields.io/badge/Language-EN-blue)
![Featured](https://img.shields.io/badge/Featured-gold)
<div align="center">
<img src="https://cms-assets.youmind.com/media/example.jpg" width="700" alt="Example image">
</div>
`;
    const [prompt] = await runPromptSource(`
const markdown = ${JSON.stringify(markdown)};
const images = extractImages("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main", markdown);
return [makePrompt({ id: "html-image", title: "HTML image", prompt: "Prompt", coverUrl: images[0] || "", preview: markdownPreview(images) })];
`);

    assert.equal(prompt.coverUrl, "https://cms-assets.youmind.com/media/example.jpg");
    assert.equal(prompt.preview, "![](https://cms-assets.youmind.com/media/example.jpg)");
});

test("parses the attributed Chinese GPT-4o gallery with stable GitHub images", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = `
### 案例 100：实物与手绘涂鸦创意广告 (by [@azed_ai](https://x.com/azed_ai))

<img src="cases/100/creative-ad-real-object-hand-drawn-doodle.png" width="300" alt="实物与手绘涂鸦创意广告">

**提示词**

\`\`\`
一则简约且富有创意的广告，设置在纯白背景上。

### 视觉元素

保持主体清晰。
\`\`\`

**需上传参考图片：** 上传一张商品照片。
`;
    const [prompt] = parseJamezBondosAwesomeGpt4oImagesMarkdown(markdown);

    assert.equal(prompt.id, "jamez-bondos-awesome-gpt4o-images-0100");
    assert.equal(prompt.title, "实物与手绘涂鸦创意广告");
    assert.equal(prompt.prompt, "一则简约且富有创意的广告，设置在纯白背景上。\n\n### 视觉元素\n\n保持主体清晰。");
    assert.equal(prompt.coverUrl, "/prompt-proxy/raw/jamez-bondos/awesome-gpt4o-images/main/cases/100/creative-ad-real-object-hand-drawn-doodle.png");
    assert.deepEqual(prompt.tags, ["gpt-4o", "gpt-image-1", "需要参考图"]);
});

test("parses unique EvoLink GPT Image 2 commercial cases with attribution and stable output images", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = `
### Case 13: [花卉精华产品大片](https://x.com/creator/status/123) (by [@creator](https://x.com/creator))

<img src="../images/ecommerce_case173/input.jpg">
<img src="../images/ecommerce_case173/output.jpg">

**提示词:**

\`\`\`
Using the uploaded image, create a premium floral skincare advertisement.
\`\`\`
`;
    const [prompt] = parseEvolinkGptImage2CommercialMarkdown(markdown, "ecommerce");

    assert.equal(prompt.id, "evolink-gpt-image-2-commercial-ecommerce-0173");
    assert.equal(prompt.title, "电商设计 · 花卉精华产品大片");
    assert.equal(prompt.coverUrl, "/prompt-proxy/raw/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/ecommerce_case173/output.jpg");
    assert.deepEqual(prompt.tags, ["gpt-image-2", "商品商业", "需要参考图"]);
    assert.match(prompt.preview, /原作者：@creator/);
    assert.match(prompt.preview, /https:\/\/x\.com\/creator\/status\/123/);
});

test("skips EvoLink cases already present in existing prompt sources", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = `
### Case 112: [Duplicate case](https://x.com/creator/status/112) (by [@creator](https://x.com/creator))

<img src="../images/poster_case112/output.jpg">

**提示词：**

\`\`\`
Duplicate prompt.
\`\`\`
`;

    assert.deepEqual(parseEvolinkGptImage2CommercialMarkdown(markdown, "ad-creative"), []);
});

test("repairs EvoLink's malformed two-level relative image path", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://canvas.example" } } });
    const markdown = `
### Case 11: [Miniature Brand Universe Shoe](https://x.com/creator/status/171) (by [@creator](https://x.com/creator))

![Output](../../images/ecommerce_case171/output.jpg)

**提示词：**

\`\`\`
Create a miniature brand universe around the uploaded shoe.
\`\`\`
`;
    const [prompt] = parseEvolinkGptImage2CommercialMarkdown(markdown, "ecommerce");

    assert.equal(prompt.id, "evolink-gpt-image-2-commercial-ecommerce-0171");
    assert.equal(prompt.coverUrl, "/prompt-proxy/raw/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/ecommerce_case171/output.jpg");
});

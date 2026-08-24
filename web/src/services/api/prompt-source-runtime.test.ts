import assert from "node:assert/strict";
import { test } from "node:test";

import { parseJamezBondosAwesomeGpt4oImagesMarkdown, runPromptSource } from "./prompt-source-runtime";

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

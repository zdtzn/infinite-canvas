import assert from "node:assert/strict";
import { test } from "node:test";

import { runPromptSource } from "./prompt-source-runtime";

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

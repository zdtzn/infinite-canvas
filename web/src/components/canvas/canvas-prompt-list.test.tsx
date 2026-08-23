import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
import type { Prompt } from "@/services/api/prompts";
import { CanvasPromptRow, mergeCanvasPromptPages } from "./canvas-prompt-list";

const prompt = (id: string, sourceId = "test-source"): Prompt => ({
    sourceId,
    id,
    title: `提示词 ${id}`,
    prompt: `正文 ${id}`,
    coverUrl: "/prompt-proxy/raw/example/repo/main/cover.jpg",
    tags: ["商品商业"],
    category: "测试来源",
    githubUrl: "https://example.com/source",
});

test("load-more appends prompt pages without duplicating repeated records", () => {
    expect(
        mergeCanvasPromptPages([
            [prompt("one"), prompt("two")],
            [prompt("two"), prompt("three")],
        ]).map((item) => item.id),
    ).toEqual(["one", "two", "three"]);
    expect(mergeCanvasPromptPages([[prompt("same", "source-a")], [prompt("same", "source-b")]])).toHaveLength(2);
});

test("canvas prompt rows use the server thumbnail proxy before external cover fallbacks", () => {
    const html = renderToStaticMarkup(
        createElement(CanvasPromptRow, {
            item: prompt("one"),
            theme: canvasThemes.light,
            onInsert: () => undefined,
            onView: () => undefined,
        }),
    );

    expect(html).toContain("/prompt-proxy/thumbnail/?url=");
    expect(html).toContain('aria-label="插入画布"');
});

import { describe, expect, test } from "bun:test";

import { runPromptSourceScript } from "./prompt-source-runtime";

describe("server prompt source runtime", () => {
  test("runs the declarative helper surface without exposing process", async () => {
    const items = await runPromptSourceScript(`
      const markdown = ["前言", "### 标题", "提示词正文"].join("\\n");
      const block = splitSections(markdown, "### ")[1];
      return [makePrompt({
        id: "demo-1",
        title: firstMatch(block, /^###\\s+(.+)$/m),
        prompt: firstMatch(block, /提示词正文/),
        tags: tagsFromHeading("电商/主图"),
      })];
    `);

    expect(items).toEqual([
      expect.objectContaining({ id: "demo-1", title: "标题", prompt: "提示词正文", tags: ["电商", "主图"] }),
    ]);
  });

  test("rejects access to server globals", async () => {
    await expect(runPromptSourceScript("return [{ id: process.env.SECRET, title: 'x', prompt: 'y' }];")).rejects.toThrow(/执行失败/);
  });
  test("accepts complete lists over 2,000 rows and rejects oversized lists", async () => {
    const script = (count: number) => `return Array.from({ length: ${count} }, (_, id) => ({id: String(id), title: "Title", prompt: "Content"}));`;
    await expect(runPromptSourceScript(script(2_001))).resolves.toHaveLength(2_001);
    await expect(runPromptSourceScript(script(20_001))).rejects.toThrow(/超过 20000 条/);
  });
});

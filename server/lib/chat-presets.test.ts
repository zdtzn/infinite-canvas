import { describe, expect, test } from "bun:test";

import {
  buildChatSystemPrompt,
  defaultChatPresetId,
  formatChatPresetUserMessage,
  resolveChatPreset,
} from "./chat-presets";

describe("chat presets", () => {
  test("falls back to the default preset for unknown ids", () => {
    expect(resolveChatPreset("unknown").id).toBe(defaultChatPresetId);
    expect(resolveChatPreset({}).id).toBe(defaultChatPresetId);
  });

  test("adds server-owned system instructions instead of accepting arbitrary prompts", () => {
    const preset = resolveChatPreset("prompt-smith");
    const system = buildChatSystemPrompt(preset);

    expect(system).toContain("当前问道模式：提示词炼师");
    expect(system).toContain("不要把所有需求都改成摄影风格");
  });

  test("uses the richer general assistant template for Tong Yong Wen Dao", () => {
    const preset = resolveChatPreset("general");
    const system = buildChatSystemPrompt(preset);

    expect(system).toContain("不是机械回答");
    expect(system).toContain("优先理解当前对话和最近上下文");
    expect(system).toContain("用户未要求价格或促销时，不主动添加价格");
  });

  test("keeps Lin Ruolan and catgirl role styles available", () => {
    const lin = buildChatSystemPrompt(resolveChatPreset("linruolan"));
    const catgirl = buildChatSystemPrompt(resolveChatPreset("catgirl"));

    expect(lin).toContain("林若兰");
    expect(lin).toContain("《红楼梦》");
    expect(lin).toContain("不主动跳出角色");
    expect(lin).toContain("【林若兰 心情 词语 ↑或者↓】");
    expect(catgirl).toContain("猫娘");
    expect(catgirl).toContain("每一句话后面都要自然加上“喵”");
    expect(catgirl).toContain("喵~你好主人");
  });

  test("formats the latest user message for the selected preset", () => {
    const preset = resolveChatPreset("product-strategist");
    const content = formatChatPresetUserMessage(preset, "给这瓶饮料做主图", false);

    expect(content).toContain("商品视觉策划师");
    expect(content).toContain("给这瓶饮料做主图");
  });

  test("uses a useful image-only prompt when there is no text", () => {
    const preset = resolveChatPreset("image-reader");
    const content = formatChatPresetUserMessage(preset, "", true);

    expect(content).toContain("请结合我上传的图片回答");
  });
});

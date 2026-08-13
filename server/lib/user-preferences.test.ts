import { describe, expect, test } from "bun:test";

import { MAX_USER_SYSTEM_PROMPT_CHARS, normalizeUserChatPresetId, normalizeUserSystemPrompt, readStoredUserChatPresetId, readStoredUserSystemPrompt } from "./user-preferences";

describe("user preferences", () => {
  test("normalizes a bounded system prompt without changing its content", () => {
    const prompt = "  你是我的生图助手。\n请只输出提示词。  ";
    expect(normalizeUserSystemPrompt(prompt)).toBe(prompt);
    expect(readStoredUserSystemPrompt(prompt)).toBe(prompt);
  });

  test("rejects oversized and control-character prompts", () => {
    expect(() => normalizeUserSystemPrompt("x".repeat(MAX_USER_SYSTEM_PROMPT_CHARS + 1))).toThrow();
    expect(() => normalizeUserSystemPrompt("valid\u0000prompt")).toThrow();
    expect(normalizeUserSystemPrompt(undefined)).toBe("");
  });

  test("accepts only registered chat presets", () => {
    expect(normalizeUserChatPresetId("catgirl")).toBe("catgirl");
    expect(normalizeUserChatPresetId(" moxuan ")).toBe("moxuan");
    expect(readStoredUserChatPresetId("general")).toBe("general");
    expect(readStoredUserChatPresetId("unknown")).toBeNull();
    expect(() => normalizeUserChatPresetId("unknown")).toThrow();
  });
});

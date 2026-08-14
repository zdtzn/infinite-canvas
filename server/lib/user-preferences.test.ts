import { describe, expect, test } from "bun:test";

import { MAX_USER_CHAT_PERSONA_CHARS, MAX_USER_SYSTEM_PROMPT_CHARS, normalizeUserChatPersona, normalizeUserChatPresetId, normalizeUserSystemPrompt, readStoredUserChatPersona, readStoredUserChatPresetId, readStoredUserSystemPrompt } from "./user-preferences";

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

  test("normalizes a bounded chat persona", () => {
    const persona = "  我是做电商视觉的创作者，偏好直接给方案。  ";
    expect(normalizeUserChatPersona(persona)).toBe("我是做电商视觉的创作者，偏好直接给方案。");
    expect(readStoredUserChatPersona(persona)).toBe("我是做电商视觉的创作者，偏好直接给方案。");
    expect(normalizeUserChatPersona(undefined)).toBe("");
    expect(() => normalizeUserChatPersona("x".repeat(MAX_USER_CHAT_PERSONA_CHARS + 1))).toThrow();
    expect(() => normalizeUserChatPersona("valid\u0000persona")).toThrow();
    expect(readStoredUserChatPersona({})).toBeNull();
  });
});

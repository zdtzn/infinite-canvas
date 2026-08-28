import { describe, expect, test } from "bun:test";

import {
  MAX_USER_CHAT_PERSONA_CHARS,
  MAX_USER_SYSTEM_PROMPT_CHARS,
  normalizeUserCanvasImageToolbar,
  normalizeUserChatPersona,
  normalizeUserChatPresetId,
  normalizeUserGenerationPreferences,
  normalizeUserSystemPrompt,
  readStoredUserCanvasImageToolbar,
  readStoredUserChatPersona,
  readStoredUserChatPresetId,
  readStoredUserGenerationPreferences,
  readStoredUserSystemPrompt,
} from "./user-preferences";

describe("user preferences", () => {
  test("normalizes a bounded system prompt without changing its content", () => {
    const prompt = "  你是我的生图助手。\n请只输出提示词。  ";
    expect(normalizeUserSystemPrompt(prompt)).toBe(prompt);
    expect(readStoredUserSystemPrompt(prompt)).toBe(prompt);
  });

  test("rejects oversized and control-character prompts", () => {
    expect(() =>
      normalizeUserSystemPrompt("x".repeat(MAX_USER_SYSTEM_PROMPT_CHARS + 1)),
    ).toThrow();
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
    expect(normalizeUserChatPersona(persona)).toBe(
      "我是做电商视觉的创作者，偏好直接给方案。",
    );
    expect(readStoredUserChatPersona(persona)).toBe(
      "我是做电商视觉的创作者，偏好直接给方案。",
    );
    expect(normalizeUserChatPersona(undefined)).toBe("");
    expect(() =>
      normalizeUserChatPersona("x".repeat(MAX_USER_CHAT_PERSONA_CHARS + 1)),
    ).toThrow();
    expect(() => normalizeUserChatPersona("valid\u0000persona")).toThrow();
    expect(readStoredUserChatPersona({})).toBeNull();
  });

  test("keeps only supported canvas image toolbar tools", () => {
    const preference = normalizeUserCanvasImageToolbar({
      ids: ["lighting", "split", "download", "split"],
      showLabels: true,
      version: 2,
    });
    expect(preference).toEqual({
      ids: ["download", "split", "lighting"],
      showLabels: true,
      version: 2,
    });
    expect(readStoredUserCanvasImageToolbar(preference)).toEqual(preference);
    expect(() =>
      normalizeUserCanvasImageToolbar({
        ids: ["download", "unknown"],
        showLabels: false,
      }),
    ).toThrow();
    expect(readStoredUserCanvasImageToolbar({ ids: "split" })).toBeNull();
  });

  test("normalizes generation preferences without accepting secrets or arbitrary fields", () => {
    const preference = normalizeUserGenerationPreferences({
      imageModel: "uu::gpt-image-2",
      videoModel: "video::seedance",
      audioModel: "audio::tts",
      audioVoice: "alloy",
      audioFormat: "mp3",
      audioSpeed: "1.25",
      audioInstructions: "自然、温暖",
      videoSeconds: "10",
      vquality: "720",
      videoGenerateAudio: "true",
      videoWatermark: "false",
      quality: "high",
      imageQuality: "auto",
      imageOutputFormat: "png",
      size: "16:9",
      background: "",
      count: "2",
      canvasImageCount: "3",
      snapDimensionToStep: false,
      apiKey: "must-not-survive",
    });

    expect(preference).toEqual({
      imageModel: "uu::gpt-image-2",
      videoModel: "video::seedance",
      audioModel: "audio::tts",
      audioVoice: "alloy",
      audioFormat: "mp3",
      audioSpeed: "1.25",
      audioInstructions: "自然、温暖",
      videoSeconds: "10",
      vquality: "720",
      videoGenerateAudio: "true",
      videoWatermark: "false",
      quality: "high",
      imageQuality: "auto",
      imageOutputFormat: "png",
      size: "16:9",
      background: "",
      count: "2",
      canvasImageCount: "3",
      snapDimensionToStep: false,
    });
    expect(readStoredUserGenerationPreferences(preference)).toEqual(preference);
    expect(() =>
      normalizeUserGenerationPreferences({ ...preference, count: "16" }),
    ).toThrow();
    expect(() =>
      normalizeUserGenerationPreferences({
        ...preference,
        imageOutputFormat: "exe",
      }),
    ).toThrow();
    expect(
      readStoredUserGenerationPreferences({
        ...preference,
        snapDimensionToStep: "true",
      }),
    ).toBeNull();
  });
});

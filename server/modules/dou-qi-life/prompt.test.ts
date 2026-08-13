import { describe, expect, test } from "bun:test";

import { buildDouQiLifeTurnPrompt, parseDouQiLifeTurnResult } from "./prompt";
import type { DouQiLifeMessage, DouQiLifeState } from "./types";

const state = {
  player: { name: "沈砚", realm: "斗之气" },
  world: { location: "青山镇" },
} as unknown as DouQiLifeState;

describe("dou qi life prompt protocol", () => {
  test("keeps the player action and recent context in the world prompt", () => {
    const messages = [{ role: "player", kind: "action", content: "观察" }] as DouQiLifeMessage[];
    const prompt = buildDouQiLifeTurnPrompt(state, messages, "走近山路");
    expect(prompt).toContain("走近山路");
    expect(prompt).toContain("观察");
    expect(prompt).toContain("青山镇");
  });

  test("parses fenced JSON and bounds suggestions", () => {
    const result = parseDouQiLifeTurnResult(`
      \`\`\`json
      {"narrative":"山风停了。","suggestions":[{"id":"one","label":"观察","action":"我观察"},{"label":"","action":"无效"}],"notice":"留意脚下"}
      \`\`\`
    `);
    expect(result).toEqual({
      narrative: "山风停了。",
      suggestions: [{ id: "one", label: "观察", action: "我观察" }],
      statePatch: undefined,
      notice: "留意脚下",
    });
  });

  test("falls back to plain provider text when JSON is unavailable", () => {
    expect(parseDouQiLifeTurnResult("世界暂未显露新的回应。"))
      .toEqual({ narrative: "世界暂未显露新的回应。", suggestions: [] });
  });
});

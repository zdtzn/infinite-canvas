import { describe, expect, test } from "bun:test";

import { buildDouQiLifeTurnPrompt, parseDouQiLifeTurnResult, projectDouQiLifeContext } from "./prompt";
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

  test("projects only bounded, relevant world context", () => {
    const projected = projectDouQiLifeContext({
      ...state,
      player: { ...state.player, name: "沈砚", realm: "斗之气", qiStage: 1, qi: 10, qiMax: 100, life: 100, lifeMax: 100, mood: "平静", condition: "正常" },
      world: { year: 1, season: "春季", month: 1, day: 1, period: "清晨", location: "青山镇", weather: "晴", scene: "街道" },
      npcs: [],
      inventory: { gold: 20, items: [] },
      techniques: [],
      battle: { active: false, enemyName: "", enemyRealm: "", enemyLife: 0, enemyLifeMax: 0, status: "" },
      memory: { recentEvents: ["近事"], longTermFacts: ["来处"], choices: ["观察"], worldEvents: [] },
    } as DouQiLifeState);
    expect(projected).toMatchObject({ world: { location: "青山镇" }, player: { name: "沈砚" }, recentEvents: ["近事"] });
    expect(JSON.stringify(projected)).not.toContain("不要把完整状态原样发送");
  });

  test("tolerates legacy NPC records without history", () => {
    const projected = projectDouQiLifeContext({
      ...state,
      world: { location: "青山镇" },
      npcs: [{
        id: "npc-elder",
        name: "守门老人",
        identity: "过客",
        realm: "斗之气",
        faction: "无",
        personality: "沉默",
        goal: "未知",
        relationship: 2,
        impression: "初见",
        secret: "",
        lastSeenAt: "第一日",
      } as unknown as DouQiLifeState["npcs"][number]],
      inventory: { gold: 0, items: [] },
      techniques: [],
      battle: { active: false, enemyName: "", enemyRealm: "", enemyLife: 0, enemyLifeMax: 0, status: "" },
      memory: { recentEvents: [], longTermFacts: [], choices: [], worldEvents: [] },
    } as DouQiLifeState);

    expect(projected.npcs[0]).toMatchObject({ name: "守门老人", history: [] });
  });

  test("falls back to plain provider text when JSON is unavailable", () => {
    expect(parseDouQiLifeTurnResult("世界暂未显露新的回应。"))
      .toEqual({ narrative: "世界暂未显露新的回应。", suggestions: [] });
  });
});

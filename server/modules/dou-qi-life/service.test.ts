import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import type { ServerState } from "../../types";
import { DouQiLifeError, createDouQiLifeService } from "./service";
import type { DouQiLifeState } from "./types";

const directories: string[] = [];

afterEach(() => {
  while (directories.length)
    try {
      rmSync(directories.pop()!, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
});

describe("dou qi life service", () => {
  test("creates isolated lives with a bounded default state", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", {
        name: "沈砚",
        birthplace: "青山镇",
        age: 17,
      });

      expect(session.state.player).toMatchObject({
        name: "沈砚",
        birthplace: "青山镇",
        age: 17,
        realm: "斗之气",
        qi: 10,
        qiMax: 100,
        life: 100,
      });
      expect(service.listSessions("alice")).toHaveLength(1);
      expect(service.listSessions("bob")).toEqual([]);
      expect(service.getSession("bob", session.id)).toBeNull();
    } finally {
      store.close();
    }
  });

  test("stores first-step suggestions with the opening narrative", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const opening = service.getSessionWithHistory("alice", session.id)?.messages[0];

      expect(opening?.metadata.suggestions).toEqual([
        expect.objectContaining({ label: "观察周围" }),
        expect.objectContaining({ label: "查看自身" }),
        expect.objectContaining({ label: "向前探索" }),
        expect.objectContaining({ label: "尝试修炼" }),
      ]);
    } finally {
      store.close();
    }
  });

  test("keeps a bounded life summary and unresolved goals across turns", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "记忆旅者", lifeGoal: "查明山中异动" });
      expect(session.state.memory.turnCount).toBe(0);
      expect(session.state.memory.unresolvedGoals).toContain("查明山中异动");
      expect(session.state.memory.storySummary).toContain("记忆旅者");

      const action = "前往山中异动所在之处";
      const started = service.beginTurn("alice", session.id, action);
      const result = service.completeTurn(
        "alice",
        session.id,
        started.worldMessage.id,
        {
          narrative: "山路尽头传来低沉的震动，附近有人留下了新的痕迹。",
          statePatch: {
            event: "发现山中异动的线索",
            worldEvent: { id: "event-memory", type: "other", title: "山中异动", status: "open", known: true, location: "青山" },
            npcUpdates: [{ id: "npc-memory", name: "叶清禾", identity: "同行者", relationship: 4, impression: "开始信任你" }],
          },
        },
        action,
        started.resolution,
      );

      expect(result.session.state.memory.turnCount).toBe(1);
      expect(result.session.state.memory.unresolvedGoals).toContain("处理：山中异动");
      expect(result.session.state.memory.storySummary.length).toBeLessThanOrEqual(1_200);
      expect(result.session.state.memory.longTermFacts.some((fact) => fact.includes("叶清禾"))).toBe(true);
      expect(service.getSession("alice", session.id)?.state.memory.storySummary).toBe(result.session.state.memory.storySummary);
    } finally {
      store.close();
    }
  });

  test("rejects a second action while preserving the first action lifecycle", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const started = service.beginTurn("alice", session.id, "观察镇外的山路");

      expect(() => service.beginTurn("alice", session.id, "立刻离开")).toThrow(
        "上一段世界回应尚未完成",
      );

      const completed = service.completeTurn(
        "alice",
        session.id,
        started.worldMessage.id,
        {
          narrative: "山风穿过林梢，远处传来车轮声。",
          suggestions: [{ id: "observe", label: "继续观察", action: "我继续观察" }],
          statePatch: {
            advanceTimeHours: 24,
            player: { qiDelta: 20, lifeDelta: -100, mood: "焦虑" },
            goldDelta: -100,
            addItems: [{ name: "青灵草", quantity: 100 }],
            addTechniques: [{ name: "引气诀", proficiency: 150 }],
            npcUpdates: [{ name: "赶车老人", relationship: 100, history: "在山路旁擦肩而过" }],
            battle: { active: true, enemyName: "山狼", enemyRealm: "斗之气", enemyLifeMax: 50, enemyLife: 90, status: "对峙中" },
          },
        },
        "观察镇外的山路",
      );

      expect(completed.session.state.world.day).toBe(2);
      expect(completed.session.state.player).toMatchObject({ qi: 30, life: 60, mood: "焦虑" });
      expect(completed.session.state.inventory.gold).toBe(0);
      expect(completed.session.state.inventory.items[0]).toMatchObject({ name: "青灵草", quantity: 10 });
      expect(completed.session.state.techniques[0]).toMatchObject({ name: "引气诀", proficiency: 100 });
      expect(completed.session.state.npcs[0]).toMatchObject({ name: "赶车老人", relationship: 10 });
      expect(completed.session.state.battle).toMatchObject({ active: true, enemyLife: 50 });
      expect(service.getSessionWithHistory("alice", session.id)?.messages).toHaveLength(3);
      expect(() => service.completeTurn("alice", session.id, started.worldMessage.id, { narrative: "重复" }, "观察镇外的山路")).toThrow(DouQiLifeError);
    } finally {
      store.close();
    }
  });

  test("stores, restores and deletes account-scoped saves", () => {
    const { store, service } = setup();
    try {
      const source = service.createSession("alice", { name: "叶清禾" });
      service.completeTurn("alice", source.id, service.beginTurn("alice", source.id, "记下镇外的路").worldMessage.id, { narrative: "我记下了这条路。" }, "记下镇外的路");
      const save = service.saveSession("alice", source.id, "镇外一刻");

      expect(service.listSaves("alice").filter((item) => item.kind === "manual")).toEqual([save]);
      expect(service.listSaves("alice").filter((item) => item.kind === "auto")).toHaveLength(1);
      expect(service.listSaves("bob")).toEqual([]);
      expect(() => service.restoreSave("bob", save.id)).toThrow("存档不存在");

      const restored = service.restoreSave("alice", save.id);
      expect(restored.id).not.toBe(source.id);
      expect(restored.title).toContain("支线");
      expect(service.getSessionWithHistory("alice", restored.id)?.messages).toHaveLength(3);
      expect(service.deleteSave("alice", save.id)).toBe(true);
      expect(service.deleteSave("alice", save.id)).toBe(false);
    } finally {
      store.close();
    }
  });

  test("advances long cultivation periods and keeps one automatic save per life", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const complete = (action: string) => service.completeTurn(
        "alice",
        session.id,
        service.beginTurn("alice", session.id, action).worldMessage.id,
        { narrative: "闭关结束。", statePatch: { advanceTimeHours: 0 } },
        action,
      );

      complete("闭关三个月");
      const afterThreeMonths = service.getSession("alice", session.id)!;
      expect(afterThreeMonths.state.world.month).toBe(4);
      expect(afterThreeMonths.state.world.day).toBe(1);
      expect(afterThreeMonths.state.player.qi).toBeGreaterThan(10);

      complete("闭关半年");
      const afterHalfYear = service.getSession("alice", session.id)!;
      expect(afterHalfYear.state.world.year).toBe(1);
      expect(afterHalfYear.state.world.month).toBe(10);
      expect(service.listSaves("alice").filter((item) => item.kind === "auto")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("does not treat a pause request as cultivation", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const action = "我暂不闭关，继续观察当前天地";
      const started = service.beginTurn("alice", session.id, action);
      const result = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative: "你暂且按下修炼的念头。",
        statePatch: { advanceTimeHours: 12 },
      }, action);

      expect(result.session.state.world.period).toBe("黄昏");
      expect(result.notice).toBe("");
      expect(result.session.state.player.qi).toBe(10);
    } finally {
      store.close();
    }
  });

  test("keeps world hours consistent across midnight and advances age days", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚", age: 18 });
      const started = service.beginTurn("alice", session.id, "观察夜色");
      const result = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative: "夜色翻过山脊。",
        statePatch: { advanceTimeHours: 20 },
      }, "观察夜色");

      expect(result.session.state.world.hour).toBe(2);
      expect(result.session.state.world.day).toBe(2);
      expect(result.session.state.world.period).toBe("深夜");
      expect(result.session.state.player.age).toBe(18);
      expect(result.session.state.player.livedDays).toBe(18 * 360 + 1);
    } finally {
      store.close();
    }
  });

  test("uses program resolution for deterministic cultivation actions", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const started = service.beginTurn("alice", session.id, "闭关一日");
      expect(started.resolution).toBeDefined();
      const result = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative: "你闭关了一日。",
        statePatch: { advanceTimeHours: 8_760, player: { qiDelta: -40, lifeDelta: -40 } },
      }, "闭关一日", started.resolution);

      expect(result.session.state.world.day).toBe(2);
      expect(result.session.state.player.qi).toBe(12);
      expect(result.session.state.player.life).toBe(100);
    } finally {
      store.close();
    }
  });

  test("allows recovery after incapacitation and blocks unrelated actions", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const finish = (action: string, statePatch: unknown = {}) => {
        const started = service.beginTurn("alice", session.id, action);
        return service.completeTurn("alice", session.id, started.worldMessage.id, { narrative: "伤势变化。", statePatch }, action, started.resolution);
      };
      finish("观察", { player: { lifeDelta: -40 } });
      finish("观察", { player: { lifeDelta: -40 } });
      finish("观察", { player: { lifeDelta: -40 } });
      expect(service.getSession("alice", session.id)?.state.player.life).toBe(0);
      expect(() => service.beginTurn("alice", session.id, "继续探索")).toThrow("重伤昏迷");

      const recovery = service.beginTurn("alice", session.id, "休养");
      const result = service.completeTurn("alice", session.id, recovery.worldMessage.id, { narrative: "你开始休养。", statePatch: { player: { lifeDelta: -40 } } }, "休养", recovery.resolution);
      expect(result.session.state.player.life).toBe(25);
      expect(result.session.state.player.condition).toBe("恢复中");
    } finally {
      store.close();
    }
  });

  test("keeps ended lives ended when restoring a save", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚", age: 99 });
      const started = service.beginTurn("alice", session.id, "观察");
      const ended = service.completeTurn("alice", session.id, started.worldMessage.id, { narrative: "寿元走到尽头。", statePatch: { advanceTimeHours: 8_640 } }, "观察");
      expect(ended.session.status).toBe("ended");

      const save = service.saveSession("alice", session.id, "终局");
      const restored = service.restoreSave("alice", save.id);
      expect(restored.status).toBe("ended");
      expect(() => service.beginTurn("alice", restored.id, "继续探索")).toThrow("这段人生已经结束");
    } finally {
      store.close();
    }
  });

  test("continues the world clock after a visit and materializes it once", () => {
    const { store, service, advanceHours } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      advanceHours(24 * 31);

      const first = service.getSessionWithHistory("alice", session.id)!;
      expect(first.session.state.world.month).toBe(2);
      expect(first.session.state.world.day).toBe(2);
      expect(first.session.state.memory.worldEvents).toHaveLength(1);
      expect(first.messages.filter((item) => item.kind === "system")).toHaveLength(1);

      const autoSave = service.listSaves("alice", session.id).find((item) => item.kind === "auto");
      expect(autoSave?.updatedAt).toBe(first.session.updatedAt);

      const second = service.getSessionWithHistory("alice", session.id)!;
      expect(second.session.state.world.month).toBe(first.session.state.world.month);
      expect(second.session.state.world.day).toBe(first.session.state.world.day);
      expect(second.messages.filter((item) => item.kind === "system")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("does not materialize offline time while a world response is streaming", () => {
    const { store, service, advanceHours } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      service.beginTurn("alice", session.id, "观察周围");
      advanceHours(24 * 31);

      const detail = service.getSessionWithHistory("alice", session.id)!;
      expect(detail.session.state.world.month).toBe(1);
      expect(detail.session.state.world.day).toBe(1);
      expect(detail.messages.filter((item) => item.kind === "system")).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("lets the program resolve battle actions instead of trusting enemy life patches", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { name: "沈砚" });
      const started = service.beginTurn("alice", session.id, "走入山林");
      const battle = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative: "林中妖兽现身。",
        statePatch: { battle: { active: true, enemyName: "山狼", enemyRealm: "斗之气", enemyLifeMax: 40, enemyLife: 1 } },
      }, "走入山林");
      expect(battle.session.state.battle.enemyLife).toBe(40);

      const attack = service.beginTurn("alice", session.id, "攻击山狼");
      const result = service.completeTurn("alice", session.id, attack.worldMessage.id, {
        narrative: "你迎着山狼出手。",
        statePatch: { battle: { active: true, enemyLife: 0 } },
      }, "攻击山狼");
      expect(result.session.state.battle.enemyLife).toBeLessThan(40);
    } finally {
      store.close();
    }
  });

  test("marks unfinished world responses as failed when the service restarts", () => {
    const { store, service, dataDir } = setup();
    const session = service.createSession("alice", { name: "顾长风" });
    const started = service.beginTurn("alice", session.id, "先听风声");
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const restarted = createDouQiLifeService(reopened.raw!, { now: () => 2_000 });
      const detail = restarted.getSessionWithHistory("alice", session.id)!;
      expect(detail.messages.find((item) => item.id === started.worldMessage.id)).toMatchObject({
        status: "failed",
        error: "服务重启，本次世界回应已中断",
      });
      expect(() => restarted.beginTurn("alice", session.id, "重新观察")).not.toThrow();
    } finally {
      reopened.close();
    }
  });

  test.each([0, 11])("rejects a technique with %i qi before creating turn messages", (qi) => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => {
        state.player.qi = qi;
        state.techniques = [technique("烈焰掌", 0)];
        state.battle = battle();
      });
      expect(() => service.beginTurn("alice", session.id, "施展斗技：烈焰掌")).toThrow("斗气不足");
      const detail = service.getSessionWithHistory("alice", session.id)!;
      expect(detail.messages).toHaveLength(1);
      expect(detail.session.state.player.qi).toBe(qi);
      expect(detail.session.state.battle.enemyLife).toBe(100);
      expect(detail.session.state.techniques[0].proficiency).toBe(0);
    } finally { store.close(); }
  });

  test("uses the named technique and rejects unknown names without falling back", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => {
        state.player.qi = 24;
        state.techniques = [technique("烈焰掌", 0), technique("奔雷拳", 80)];
        state.battle = battle();
      });
      expect(() => service.beginTurn("alice", session.id, "施展斗技：不存在的斗技")).toThrow("未掌握");
      const result = completeAction(service, session.id, "施展斗技：奔雷拳");
      expect(result.session.state.player.qi).toBe(12);
      expect(result.session.state.battle.enemyLife).toBe(63);
      expect(result.session.state.battle.status).toBe("奔雷拳命中");
      expect(result.session.state.techniques.map((item) => item.proficiency)).toEqual([0, 82]);
    } finally { store.close(); }
  });

  test("allows a physical attack with zero qi and caps its qi cost at five", () => {
    const { store, service } = setup();
    try {
      for (const qi of [0, 3, 8]) {
        const session = service.createSession("alice");
        updateState(store, session.id, (state) => { state.player.qi = qi; state.battle = battle(); });
        const result = completeAction(service, session.id, "攻击山狼");
        expect(result.session.state.player.qi).toBe(qi > 5 ? qi - 5 : 0);
        expect(result.session.state.battle.enemyLife).toBe(83);
      }
    } finally { store.close(); }
  });

  test.each(["闭关一个月", "打坐一天", "突破", "晋阶", "炼化魔核一天"])("rejects %s during combat", (action) => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => { state.battle = battle(); state.player.qi = 100; });
      const before = service.getSession("alice", session.id)!.state;
      expect(() => service.beginTurn("alice", session.id, action)).toThrow("战斗中");
      expect(service.getSession("alice", session.id)!.state).toEqual(before);
      expect(service.getSessionWithHistory("alice", session.id)!.messages).toHaveLength(1);
    } finally { store.close(); }
  });

  test("does not cultivate merely because an action mentions a duration", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      const result = completeAction(service, session.id, "等待一天");
      expect(result.session.state.world.day).toBe(2);
      expect(result.session.state.player.qi).toBe(10);
      expect(result.session.state.player.condition).toBe("正常");
    } finally { store.close(); }
  });

  test.each([false, true])("consumes only the named healing item (combat: %s)", (inCombat) => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => {
        state.player.life = 30;
        state.inventory.items = [
          { id: "item-first", name: "疗伤丹", category: "丹药", quantity: 2, description: "恢复生命" },
          { id: "item-second", name: "恢复丸", category: "丹药", quantity: 1, description: "恢复生命" },
          { id: "item-empty", name: "枯灵丹", category: "丹药", quantity: 0, description: "恢复生命" },
          { id: "item-sword", name: "铁剑", category: "武器", quantity: 1, description: "普通兵器" },
        ];
        if (inCombat) state.battle = battle();
      });
      expect(() => service.beginTurn("alice", session.id, "使用道具：不存在的丹药")).toThrow("没有可用");
      expect(() => service.beginTurn("alice", session.id, "使用道具：枯灵丹")).toThrow("没有可用");
      expect(() => service.beginTurn("alice", session.id, "使用道具：铁剑")).toThrow("不能用于疗伤");
      const result = completeAction(service, session.id, "使用道具：恢复丸", {
        player: { lifeDelta: 40 }, addItems: [{ name: "恢复丸", quantity: 10 }],
      });
      expect(result.session.state.player.life).toBe(inCombat ? 51 : 55);
      expect(result.session.state.inventory.items.find((item) => item.name === "疗伤丹")?.quantity).toBe(2);
      expect(result.session.state.inventory.items.some((item) => item.name === "恢复丸")).toBe(false);
      expect(() => service.beginTurn("alice", session.id, "使用道具：恢复丸")).toThrow("没有可用");
    } finally { store.close(); }
  });

  test("retains validated deterministic narration without accepting mechanical overrides or counting twice", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      const action = "闭关一日";
      const started = service.beginTurn("alice", session.id, action);
      const narrative = "叶清禾在洞外留下约定，明日与你一同调查山谷。";
      const result = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative, suggestions: [], statePatch: {
          advanceTimeHours: 8760,
          world: { location: "模型改写地点", hour: 0 },
          player: { qiDelta: 60, lifeDelta: -40, realm: "斗帝", mood: "心魔", condition: "寿元已尽" },
          battle: { active: true, enemyName: "虚构敌人", enemyLife: 1 },
          goldDelta: 1000, addItems: [{ name: "虚构丹药", quantity: 10 }],
          addTechniques: [{ name: "虚构功法", proficiency: 100 }],
          npcUpdates: [{ name: "叶清禾", relationshipDelta: 999, history: narrative }],
          event: "与叶清禾约定调查山谷",
          worldEvent: { id: "event-valley", title: "山谷约定", type: "other", status: "investigating", known: true },
          memory: { turnCount: 999, storySummary: "模型覆盖摘要" },
        },
      }, action, started.resolution);
      expect(result.session.state.player).toEqual(started.resolution!.state.player);
      expect(result.session.state.world).toEqual(started.resolution!.state.world);
      expect(result.session.state.battle).toEqual(started.resolution!.state.battle);
      expect(result.session.state.inventory).toEqual(started.resolution!.state.inventory);
      expect(result.session.state.techniques).toEqual(started.resolution!.state.techniques);
      expect(result.session.state.memory.turnCount).toBe(1);
      expect(result.session.state.memory.recentEvents).toContain(narrative);
      expect(result.session.state.memory.longTermFacts).toContain("发生过事件：与叶清禾约定调查山谷");
      expect(result.session.state.npcs[0]).toMatchObject({ name: "叶清禾", relationship: 10, history: [narrative] });
      expect(result.session.state.memory.worldEvents[0].status).toBe("investigating");
      for (let index = 0; index < 5; index++) completeAction(service, session.id, "闭关一日");
      const state = service.getSession("alice", session.id)!.state;
      expect(state.memory.turnCount).toBe(6);
      expect(state.memory.storySummary).toContain("叶清禾");
    } finally { store.close(); }
  });

  test("protects deterministic battle state even when the caller omits the cached resolution", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => { state.battle = battle(); });
      const action = "攻击山狼";
      const started = service.beginTurn("alice", session.id, action);
      const result = service.completeTurn("alice", session.id, started.worldMessage.id, {
        narrative: "山狼退后，旁观者记住了你。", suggestions: [],
        statePatch: { goldDelta: 1000, removeItems: [], battle: { active: false }, npcUpdates: [{ name: "旁观者", relationship: 5 }] },
      }, action);
      expect(result.session.state.battle).toEqual(started.resolution!.state.battle);
      expect(result.session.state.inventory.gold).toBe(20);
      expect(result.session.state.npcs[0].name).toBe("旁观者");
    } finally { store.close(); }
  });

  test("fails only streaming world messages and trims repeated failed turns", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      const completed = completeAction(service, session.id, "观察");
      expect(service.failTurn("alice", session.id, completed.worldMessage.id, "迟到的取消")).toBeNull();
      expect(service.getSessionWithHistory("alice", session.id)!.messages.at(-1)?.status).toBe("completed");
      let lastId = "";
      for (let index = 0; index < 205; index++) {
        const started = service.beginTurn("alice", session.id, `失败行动-${index}`);
        expect(service.failTurn("alice", session.id, started.playerMessage.id, "误用")).toBeNull();
        expect(service.failTurn("alice", session.id, started.worldMessage.id, "上游失败")?.status).toBe("failed");
        expect(service.failTurn("alice", session.id, started.worldMessage.id, "覆盖错误")).toBeNull();
        lastId = started.worldMessage.id;
      }
      const detail = service.getSessionWithHistory("alice", session.id)!;
      expect(detail.messages).toHaveLength(400);
      expect(detail.messages.at(-1)).toMatchObject({ id: lastId, status: "failed", error: "上游失败" });
      expect((store.raw!.query("SELECT COUNT(*) count FROM douqi_life_messages WHERE session_id = ?").get(session.id) as { count: number }).count).toBe(400);
    } finally { store.close(); }
  });

  test("reads the newest 400 messages in chronological insertion order", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      const insert = store.raw!.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES ('alice', ?, ?, 'world', 'system', ?, '{}', 'completed', '', 1000, 1000)");
      store.raw!.transaction(() => {
        for (let index = 0; index < 405; index++) insert.run(`message-${index}`, session.id, `消息-${index}`);
      })();
      const messages = service.getSessionWithHistory("alice", session.id)!.messages;
      expect(messages).toHaveLength(400);
      expect(messages[0].content).toBe("消息-5");
      expect(messages.at(-1)?.content).toBe("消息-404");
    } finally { store.close(); }
  });

  test("preserves fractional offline hours across frequent reads", () => {
    const { store, service, advanceHours } = setup();
    try {
      const frequent = service.createSession("alice");
      const once = service.createSession("alice");
      for (let index = 0; index < 20; index++) {
        advanceHours(1.5);
        service.getSession("alice", frequent.id);
      }
      expect(service.getSession("alice", frequent.id)!.state.world).toEqual(service.getSession("alice", once.id)!.state.world);
    } finally { store.close(); }
  });

  test.each(["观察", "闭关一日"])("preserves offline remainder across a completed %s turn", (action) => {
    const { store, service, advanceHours } = setup();
    try {
      const session = service.createSession("alice");
      advanceHours(1.5);
      service.getSession("alice", session.id);
      completeAction(service, session.id, action);
      advanceHours(0.5);
      const world = service.getSession("alice", session.id)!.state.world;
      expect(world.hour).toBe(8);
      expect(world.day).toBe(action === "闭关一日" ? 2 : 1);
    } finally { store.close(); }
  });

  test.each([true, false])("preserves remainder without counting model wait time (cached resolution: %s)", (cached) => {
    const { store, service, advanceHours } = setup();
    try {
      const session = service.createSession("alice");
      advanceHours(1.5);
      const action = "闭关一日";
      const started = service.beginTurn("alice", session.id, action);
      advanceHours(2);
      service.completeTurn("alice", session.id, started.worldMessage.id, { narrative: "闭关结束。", suggestions: [] }, action, cached ? started.resolution : undefined);
      advanceHours(0.5);
      const world = service.getSession("alice", session.id)!.state.world;
      expect(world.hour).toBe(8);
      expect(world.day).toBe(2);
    } finally { store.close(); }
  });

  test("emits every crossed month for both bulk and incremental cultivation", () => {
    const { store, service } = setup();
    try {
      const bulk = service.createSession("alice");
      const incremental = service.createSession("alice");
      completeAction(service, bulk.id, "闭关半年");
      for (let index = 0; index < 6; index++) completeAction(service, incremental.id, "闭关一个月");
      const first = service.getSession("alice", bulk.id)!.state;
      const second = service.getSession("alice", incremental.id)!.state;
      expect(first.world).toEqual(second.world);
      expect(first.memory.worldEvents).toHaveLength(6);
      expect(first.memory.worldEvents).toEqual(second.memory.worldEvents);
    } finally { store.close(); }
  });

  test("keeps named resource keywords from being interpreted as cultivation, escape or defense", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      updateState(store, session.id, (state) => {
        state.player.qi = 24;
        state.player.life = 50;
        state.techniques = [technique("吐纳突破防御掌", 0)];
        state.inventory.items = [{ id: "item-named", name: "离开施展丹", category: "丹药", quantity: 1, description: "疗伤" }];
        state.battle = battle();
      });
      const techniqueResult = completeAction(service, session.id, "施展斗技：吐纳突破防御掌");
      expect(techniqueResult.session.state.battle.enemyLife).toBe(73);
      expect(techniqueResult.session.state.world.day).toBe(1);
      const itemResult = completeAction(service, session.id, "使用道具：离开施展丹");
      expect(itemResult.session.state.battle.active).toBe(true);
      expect(itemResult.session.state.inventory.items).toHaveLength(0);
      expect(itemResult.session.state.player.life).toBe(67);
    } finally { store.close(); }
  });

  test("defaults valid item quantities to one and removes one when quantity is omitted", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice");
      const added = completeAction(service, session.id, "接过物品", { addItems: [
        { name: "疗伤丹", category: "丹药" },
        { name: "青灵草", quantity: 2 },
        { name: "无效物品", quantity: "invalid" },
        null,
      ] });
      expect(added.session.state.inventory.items.map((item) => [item.name, item.quantity])).toEqual([["疗伤丹", 1], ["青灵草", 2]]);
      const removed = completeAction(service, session.id, "交出材料", { removeItems: [{ name: "青灵草" }] });
      expect(removed.session.state.inventory.items.find((item) => item.name === "青灵草")?.quantity).toBe(1);
    } finally { store.close(); }
  });

  test("emits calendar-boundary events identically across frequent visits and year rollover", () => {
    const { store, service, advanceHours } = setup();
    try {
      const frequent = service.createSession("alice");
      const once = service.createSession("alice");
      for (const session of [frequent, once]) updateState(store, session.id, (state) => {
        state.world.month = 12; state.world.day = 30; state.world.hour = 23; state.world.period = "夜间";
      });
      for (let index = 0; index < 31; index++) {
        advanceHours(24);
        const first = service.getSession("alice", frequent.id)!;
        expect(service.getSession("alice", frequent.id)!.state.memory.worldEvents).toEqual(first.state.memory.worldEvents);
      }
      const daily = service.getSession("alice", frequent.id)!.state;
      const single = service.getSession("alice", once.id)!.state;
      expect(daily.world).toEqual(single.world);
      expect(daily.memory.worldEvents).toEqual(single.memory.worldEvents);
      expect(daily.memory.worldEvents.map((event) => event.occurredAt)).toEqual(["2年2月1日", "2年1月1日"]);
      const auto = service.listSaves("alice", frequent.id).find((save) => save.kind === "auto")!;
      const restored = service.restoreSave("alice", auto.id);
      advanceHours(24);
      expect(service.getSession("alice", restored.id)!.state.memory.worldEvents).toEqual(daily.memory.worldEvents);
    } finally { store.close(); }
  });

  test("ends recovery at lifespan expiry and never extends lifespan while parsing", () => {
    const { store, service } = setup();
    try {
      const session = service.createSession("alice", { age: 99 });
      updateState(store, session.id, (state) => {
        state.player.livedDays = 100 * 360 - 1;
        state.player.life = 0;
        state.player.condition = "重伤昏迷";
      });
      const result = completeAction(service, session.id, "休养");
      expect(result.session.status).toBe("ended");
      expect(result.session.state.player).toMatchObject({ age: 100, lifespan: 100, condition: "寿元已尽" });
      expect(service.getSession("alice", session.id)!.state.player.lifespan).toBe(100);
      const save = service.saveSession("alice", session.id, "寿尽");
      expect(service.restoreSave("alice", save.id).status).toBe("ended");
      expect(() => service.beginTurn("alice", session.id, "继续休养")).toThrow("已经结束");
    } finally { store.close(); }
  });

  test("previews saved state without offline progression and renames only account-owned manual saves", () => {
    const { store, service, advanceHours, advanceTime } = setup();
    try {
      const session = service.createSession("alice", { name: "存档旅者" });
      const save = service.saveSession("alice", session.id, "山路旧事");
      const before = store.raw!.query("SELECT * FROM douqi_life_sessions WHERE session_id = ?").get(session.id);
      const original = service.getSavePreview("alice", save.id);
      advanceHours(31 * 24);
      expect(service.getSavePreview("alice", save.id)).toEqual(original);
      expect(store.raw!.query("SELECT * FROM douqi_life_sessions WHERE session_id = ?").get(session.id)).toEqual(before);
      expect(original.state.world.month).toBe(1);
      expect(original.title).toBe(session.title);
      expect(() => service.getSavePreview("bob", save.id)).toThrow("存档不存在");
      expect(() => service.renameSave("bob", save.id, "越权")).toThrow("存档不存在");
      expect(() => service.renameSave("alice", save.id, "  ")).toThrow("存档名称");
      const auto = service.listSaves("alice", session.id).find((item) => item.kind === "auto")!;
      expect(() => service.renameSave("alice", auto.id, "自动改名")).toThrow("手动存档");
      advanceTime();
      const renamed = service.renameSave("alice", save.id, "  重逢前夕  ");
      expect(renamed).toMatchObject({ id: save.id, title: "重逢前夕", createdAt: save.createdAt });
      expect(renamed.updatedAt).toBeGreaterThan(save.updatedAt);
      const preview = service.getSavePreview("alice", save.id);
      expect(preview).toEqual({ ...original, save: renamed });
      expect(service.listSaves("alice", session.id).find((item) => item.id === save.id)).toEqual(renamed);
    } finally { store.close(); }
  });

  test("restores failed and interrupted messages with branch provenance", () => {
    const { store, service, advanceTime } = setup();
    try {
      const session = service.createSession("alice");
      const failed = service.beginTurn("alice", session.id, "失败行动");
      service.failTurn("alice", session.id, failed.worldMessage.id, "上游故障");
      service.beginTurn("alice", session.id, "尚未完成的行动");
      const save = service.saveSession("alice", session.id, "分歧点");
      advanceTime();
      const renamed = service.renameSave("alice", save.id, "重逢前夕");
      const restored = service.restoreSave("alice", save.id);
      const origin = { sessionId: session.id, saveId: save.id, title: renamed.title, createdAt: save.createdAt };
      expect(restored.state.memory.branchOrigin).toEqual(origin);
      expect(restored.title).toBe("重逢前夕 · 支线");
      expect(service.getSession("alice", restored.id)!.state.memory.branchOrigin).toEqual(origin);
      const messages = service.getSessionWithHistory("alice", restored.id)!.messages;
      expect(messages[2]).toMatchObject({ status: "failed", error: "上游故障" });
      expect(messages[4]).toMatchObject({ status: "failed" });
      expect(messages[4].error).not.toBe("");
      expect(() => service.beginTurn("alice", restored.id, "继续观察")).not.toThrow();
      expect(service.getSavePreview("alice", save.id).state.memory.branchOrigin).toBeUndefined();
    } finally { store.close(); }
  });
});

function updateState(store: ReturnType<typeof openAppDatabase>, sessionId: string, change: (state: DouQiLifeState) => void) {
  const row = store.raw!.query("SELECT state_json FROM douqi_life_sessions WHERE session_id = ?").get(sessionId) as { state_json: string };
  const state = JSON.parse(row.state_json) as DouQiLifeState;
  change(state);
  store.raw!.query("UPDATE douqi_life_sessions SET state_json = ? WHERE session_id = ?").run(JSON.stringify(state), sessionId);
}

function completeAction(service: ReturnType<typeof createDouQiLifeService>, sessionId: string, action: string, statePatch: unknown = {}) {
  const started = service.beginTurn("alice", sessionId, action);
  return service.completeTurn("alice", sessionId, started.worldMessage.id, { narrative: "世界随行动变化。", suggestions: [], statePatch }, action, started.resolution);
}

function technique(name: string, proficiency: number): DouQiLifeState["techniques"][number] {
  return { id: `tech-${name}`, name, kind: "斗技", grade: "黄阶", attribute: "火", effect: "攻击", proficiency, source: "测试" };
}

function battle(): DouQiLifeState["battle"] {
  return { active: true, enemyName: "山狼", enemyRealm: "斗之气", enemyLife: 100, enemyLifeMax: 100, status: "对峙中" };
}

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "dou-qi-life-"));
  directories.push(dataDir);
  const store = openAppDatabase({ dataDir });
  const state: ServerState = {
    version: 1,
    auth: { accessCodeHash: "", sessionSecret: "secret", adminUserId: "admin" },
    users: {
      admin: { userId: "admin", displayName: "Admin", admin: true, createdAt: 1 },
      alice: { userId: "alice", displayName: "Alice", createdAt: 1 },
      bob: { userId: "bob", displayName: "Bob", createdAt: 1 },
    },
    channels: {},
    assets: {},
    jobs: {},
    projects: {},
    projectTombstones: {},
  };
  store.saveState(state);
  let timestamp = 1_000;
  return {
    store,
    dataDir,
    service: createDouQiLifeService(store.raw!, { now: () => timestamp }),
    advanceTime: () => { timestamp += 1_000; },
    advanceHours: (hours: number) => { timestamp += hours * 3_600_000; },
  };
}

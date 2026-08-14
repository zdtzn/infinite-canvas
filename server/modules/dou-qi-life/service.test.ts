import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import type { ServerState } from "../../types";
import { DouQiLifeError, createDouQiLifeService } from "./service";

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
      expect(restored.title).toContain("续");
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
});

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

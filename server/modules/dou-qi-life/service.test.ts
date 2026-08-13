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
      expect(service.getSessionWithHistory("alice", session.id)?.messages).toHaveLength(2);
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

      expect(service.listSaves("alice")).toEqual([save]);
      expect(service.listSaves("bob")).toEqual([]);
      expect(() => service.restoreSave("bob", save.id)).toThrow("存档不存在");

      const restored = service.restoreSave("alice", save.id);
      expect(restored.id).not.toBe(source.id);
      expect(restored.title).toContain("续");
      expect(service.getSessionWithHistory("alice", restored.id)?.messages).toHaveLength(2);
      expect(service.deleteSave("alice", save.id)).toBe(true);
      expect(service.deleteSave("alice", save.id)).toBe(false);
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
  };
}

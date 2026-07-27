import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "./database";

const directories: string[] = [];

afterEach(() => {
  while (directories.length) {
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
  }
});

describe("SQLite application database", () => {
  test("migrates legacy state atomically and stores reference images as files", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const reference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JdVQAAAAASUVORK5CYII=";
    writeFileSync(
      join(dataDir, "state.json"),
      JSON.stringify({
        version: 1,
        auth: {
          accessCodeHash: "hash",
          sessionSecret: "secret",
          adminUserId: "admin",
        },
        users: {
          admin: {
            userId: "admin",
            displayName: "Admin",
            admin: true,
            createdAt: 1,
          },
        },
        channels: {},
        assets: {},
        jobs: {
          job1: {
            id: "job1",
            status: "queued",
            createdAt: 2,
            input: {
              userId: "admin",
              channelId: "channel",
              apiFormat: "openai",
              model: "gpt-image-1",
              prompt: "test",
              count: 1,
              references: [reference],
            },
          },
        },
        projects: {
          admin: {
            project1: {
              project: { id: "project1" },
              revision: 1,
              updatedAt: 3,
            },
          },
        },
      }),
    );

    const store = openAppDatabase({ dataDir });
    try {
      const state = store.loadState();
      const storedReference = state.jobs.job1.input.references[0];

      expect(store.mode).toBe("sqlite");
      expect(state.users.admin.displayName).toBe("Admin");
      expect(Object.keys(state.projects.admin)).toEqual(["project1"]);
      expect(storedReference).toMatchObject({ mimeType: "image/png" });
      if (typeof storedReference === "string")
        throw new Error("Reference was not migrated");
      expect(readFileSync(join(dataDir, storedReference.path))).toEqual(
        Buffer.from(reference.split(",")[1], "base64"),
      );
      expect(store.countRows("users")).toBe(1);
      expect(store.countRows("jobs")).toBe(1);
      expect(store.countRows("projects")).toBe(1);
      expect(Bun.file(join(dataDir, "state.json.backup")).size).toBeGreaterThan(
        0,
      );
    } finally {
      store.close();
    }
  });

  test("enables WAL, foreign keys and busy timeout", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });

    expect(store.pragma("journal_mode").toLowerCase()).toBe("wal");
    expect(Number(store.pragma("foreign_keys"))).toBe(1);
    expect(Number(store.pragma("busy_timeout"))).toBeGreaterThanOrEqual(5_000);
    store.close();
  });

  test("persists hot-path assets, jobs and projects without replacing the full state", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const state = store.loadState();
      state.users.user = {
        userId: "user",
        displayName: "User",
        createdAt: 1,
      };
      store.saveState(state);

      store.saveAsset({
        key: "image:one",
        userId: "user",
        mimeType: "image/png",
        bytes: 123,
        createdAt: 2,
      });
      store.saveJob({
        id: "job-one",
        status: "succeeded",
        createdAt: 3,
        finishedAt: 4,
        input: {
          userId: "user",
          channelId: "channel",
          apiFormat: "openai",
          model: "gpt-image-1",
          prompt: "test",
          count: 1,
          references: [],
        },
        result: {
          images: [],
          successCount: 1,
          failCount: 0,
          durationMs: 1,
        },
      });
      store.saveProject("user", "project-one", {
        project: { id: "project-one", nodes: [] },
        revision: 1,
        updatedAt: 5,
      });

      expect(store.loadState()).toMatchObject({
        assets: {
          "user:image:one": {
            key: "image:one",
            bytes: 123,
          },
        },
        jobs: {
          "job-one": {
            status: "succeeded",
          },
        },
        projects: {
          user: {
            "project-one": {
              revision: 1,
            },
          },
        },
      });

      store.deleteProjectWithTombstone("user", "project-one", {
        revision: 2,
        deletedAt: 6,
      });
      store.deleteAsset("user", "image:one");
      store.deleteJob("job-one");

      const cleaned = store.loadState();
      expect(cleaned.assets).toEqual({});
      expect(cleaned.jobs).toEqual({});
      expect(cleaned.projects.user).toBeUndefined();
      expect(cleaned.projectTombstones.user?.["project-one"]).toEqual({
        revision: 2,
        deletedAt: 6,
      });
    } finally {
      store.close();
    }
  });

  test("persists isolated asset-library catalogs, including an intentionally empty catalog", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const state = store.loadState();
      state.users.alice = {
        userId: "alice",
        displayName: "Alice",
        createdAt: 1,
      };
      state.users.bob = {
        userId: "bob",
        displayName: "Bob",
        createdAt: 2,
      };
      store.saveState(state);

      expect(store.loadAssetLibrary("alice")).toEqual({
        initialized: false,
        items: [],
      });
      store.replaceAssetLibrary("alice", [
        {
          id: "asset-a",
          payload: { id: "asset-a", kind: "text", title: "Alice only" },
          updatedAt: 10,
        },
      ]);
      store.upsertAssetLibraryItem("bob", {
        id: "asset-b",
        payload: { id: "asset-b", kind: "text", title: "Bob only" },
        updatedAt: 11,
      });

      expect(store.loadAssetLibrary("alice").items).toHaveLength(1);
      expect(store.loadAssetLibrary("alice").items[0].payload.title).toBe(
        "Alice only",
      );
      expect(store.loadAssetLibrary("bob").items[0].payload.title).toBe(
        "Bob only",
      );

      store.deleteAssetLibraryItem("alice", "asset-a");
      expect(store.loadAssetLibrary("alice")).toEqual({
        initialized: true,
        items: [],
      });
      expect(store.loadAssetLibrary("bob").items).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("accepts state snapshots created before project tombstones existed", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const legacyState = store.loadState() as ReturnType<typeof store.loadState> & {
        projectTombstones?: ReturnType<typeof store.loadState>["projectTombstones"];
      };
      delete legacyState.projectTombstones;

      expect(() => store.saveState(legacyState)).not.toThrow();
      expect(store.loadState().projectTombstones).toEqual({});
    } finally {
      store.close();
    }
  });

  test("normalizes legacy Dou Emperor stars into one terminal stage", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    const database = store.raw;
    if (!database) throw new Error("Expected SQLite database");
    try {
      database
        .query(
          "INSERT INTO realms(id, theme_key, code, name, color, icon_key, animation_preset, sort_order, daily_limit, max_concurrency, promotion_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "realm-dou-emperor",
          "doupo-default",
          "dou-emperor",
          "斗帝",
          "#111827",
          "Infinity",
          "minimal-line",
          13,
          null,
          2,
          "boundary_manual",
        );
      database
        .query(
          "INSERT INTO realm_stages(id, realm_id, name, stage_order, required_xp, active) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .run("realm-dou-emperor-1", "realm-dou-emperor", "一星", 1, 100);
      database
        .query(
          "INSERT INTO realm_stages(id, realm_id, name, stage_order, required_xp, active) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .run("realm-dou-emperor-2", "realm-dou-emperor", "二星", 2, 200);
      database
        .query(
          "INSERT INTO users(user_id, display_name, is_admin, status, created_at) VALUES (?, ?, 0, 'NORMAL', ?)",
        )
        .run("emperor", "Emperor", 1);
      database
        .query(
          "INSERT INTO user_cultivation(user_id, stage_id, current_xp, total_xp, unlimited_quota, pending_stage_id, started_at, updated_at) VALUES (?, ?, 0, 0, 1, ?, 1, 1)",
        )
        .run("emperor", "realm-dou-emperor-2", "realm-dou-emperor-2");
      database.query("DELETE FROM schema_migrations WHERE version = 2").run();
    } finally {
      store.close();
    }

    const reopened = openAppDatabase({ dataDir });
    try {
      const database = reopened.raw;
      if (!database) throw new Error("Expected SQLite database");
      expect(
        database
          .query("SELECT name FROM realm_stages WHERE id = ?")
          .get("realm-dou-emperor-1"),
      ).toMatchObject({ name: "斗帝" });
      expect(
        database
          .query("SELECT active FROM realm_stages WHERE id = ?")
          .get("realm-dou-emperor-2"),
      ).toMatchObject({ active: 0 });
      expect(
        database
          .query(
            "SELECT stage_id, pending_stage_id FROM user_cultivation WHERE user_id = ?",
          )
          .get("emperor"),
      ).toMatchObject({
        stage_id: "realm-dou-emperor-1",
        pending_stage_id: null,
      });
    } finally {
      reopened.close();
    }
  });

  test("converts existing approval-based cultivation progress to automatic promotion", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    const database = store.raw;
    if (!database) throw new Error("Expected SQLite database");
    try {
      const insertRealm = database.query(
        "INSERT INTO realms(id, theme_key, code, name, color, icon_key, animation_preset, sort_order, daily_limit, max_concurrency, promotion_policy) VALUES (?, 'test', ?, ?, '#111827', 'Star', 'minimal-line', ?, 10, 1, ?)",
      );
      insertRealm.run(
        "realm-test-novice",
        "test-novice",
        "初境",
        1,
        "boundary_manual",
      );
      insertRealm.run(
        "realm-test-adept",
        "test-adept",
        "进境",
        2,
        "manual",
      );
      const insertStage = database.query(
        "INSERT INTO realm_stages(id, realm_id, name, stage_order, required_xp, active) VALUES (?, ?, ?, ?, ?, 1)",
      );
      insertStage.run(
        "stage-test-novice-1",
        "realm-test-novice",
        "一段",
        1,
        100,
      );
      insertStage.run(
        "stage-test-adept-1",
        "realm-test-adept",
        "一星",
        2,
        120,
      );
      insertStage.run(
        "stage-test-adept-2",
        "realm-test-adept",
        "二星",
        3,
        200,
      );
      database
        .query(
          "INSERT INTO users(user_id, display_name, is_admin, status, created_at) VALUES ('legacy-user', 'Legacy User', 0, 'NORMAL', 1)",
        )
        .run();
      database
        .query(
          "INSERT INTO user_cultivation(user_id, stage_id, current_xp, total_xp, unlimited_quota, pending_stage_id, started_at, updated_at) VALUES ('legacy-user', 'stage-test-novice-1', 230, 230, 0, 'stage-test-adept-1', 1, 1)",
        )
        .run();
      database
        .query(
          "INSERT INTO breakthrough_history(id, user_id, from_stage_id, to_stage_id, status, created_at) VALUES ('legacy-pending', 'legacy-user', 'stage-test-novice-1', 'stage-test-adept-1', 'pending', 1)",
        )
        .run();
      database.query("DELETE FROM schema_migrations WHERE version = 3").run();
    } finally {
      store.close();
    }

    const reopened = openAppDatabase({ dataDir });
    try {
      const database = reopened.raw;
      if (!database) throw new Error("Expected SQLite database");
      expect(
        database
          .query(
            "SELECT DISTINCT promotion_policy FROM realms ORDER BY promotion_policy",
          )
          .all(),
      ).toEqual([{ promotion_policy: "auto" }]);
      expect(
        database
          .query(
            "SELECT stage_id, current_xp, pending_stage_id FROM user_cultivation WHERE user_id = 'legacy-user'",
          )
          .get(),
      ).toEqual({
        stage_id: "stage-test-adept-2",
        current_xp: 10,
        pending_stage_id: null,
      });
      expect(
        database
          .query(
            "SELECT from_stage_id, to_stage_id, status FROM breakthrough_history WHERE user_id = 'legacy-user' ORDER BY created_at, from_stage_id",
          )
          .all(),
      ).toEqual([
        {
          from_stage_id: "stage-test-novice-1",
          to_stage_id: "stage-test-adept-1",
          status: "automatic",
        },
        {
          from_stage_id: "stage-test-adept-1",
          to_stage_id: "stage-test-adept-2",
          status: "automatic",
        },
      ]);
    } finally {
      reopened.close();
    }
  });

  test("fails closed and preserves the legacy state when the first SQLite migration fails", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const reference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JdVQAAAAASUVORK5CYII=";
    writeFileSync(
      join(dataDir, "state.json"),
      JSON.stringify({
        version: 1,
        auth: {
          accessCodeHash: "hash",
          sessionSecret: "secret",
          adminUserId: "user",
        },
        users: { user: { userId: "user", displayName: "User", createdAt: 1 } },
        channels: {},
        assets: {},
        jobs: {
          job1: {
            id: "job1",
            status: "queued",
            createdAt: 2,
            input: {
              userId: "user",
              channelId: "channel",
              apiFormat: "openai",
              model: "gpt-image-1",
              prompt: "test",
              count: 1,
              references: [reference],
            },
          },
        },
        projects: {},
      }),
    );
    writeFileSync(join(dataDir, "job-references"), "blocks directory creation");

    expect(() => openAppDatabase({ dataDir })).toThrow();
    expect(JSON.parse(readFileSync(join(dataDir, "state.json"), "utf8"))).toMatchObject({ jobs: { job1: { input: { references: [reference] } } } });
    expect(existsSync(join(dataDir, "app.sqlite"))).toBe(false);
  });
});

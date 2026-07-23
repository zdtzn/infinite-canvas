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

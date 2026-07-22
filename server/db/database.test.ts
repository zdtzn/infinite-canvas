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
    const reference = `data:image/png;base64,${Buffer.from("reference-image").toString("base64")}`;
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
        Buffer.from("reference-image"),
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

  test("falls back to the legacy state when the first SQLite migration fails", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-db-"));
    directories.push(dataDir);
    const reference = `data:image/png;base64,${Buffer.from("reference-image").toString("base64")}`;
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

    const store = openAppDatabase({ dataDir });
    try {
      expect(store.mode).toBe("legacy");
      expect(store.loadState().jobs.job1.input.references[0]).toBe(reference);
      expect(existsSync(join(dataDir, "app.sqlite"))).toBe(false);
    } finally {
      store.close();
    }
  });
});

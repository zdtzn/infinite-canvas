import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteBackup, createSqliteBackupManager } from "./sqlite-backup";

test("creates a verified SQLite snapshot and keeps only the configured history", () => {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-backup-"));
  const database = new Database(join(directory, "source.sqlite"), {
    create: true,
    strict: true,
  });
  try {
    database.exec(
      "CREATE TABLE example(value TEXT); INSERT INTO example VALUES ('preserved')",
    );
    const backupDirectory = join(directory, "backups");
    for (let index = 0; index < 3; index += 1)
      createSqliteBackup(
        database,
        backupDirectory,
        2,
        new Date(Date.UTC(2026, 6, 26, 1, 0, index)),
      );

    const files = readdirSync(backupDirectory).filter((file) =>
      file.endsWith(".sqlite"),
    );
    expect(files).toHaveLength(2);
    const backup = new Database(join(backupDirectory, files[0]), {
      readonly: true,
      strict: true,
    });
    try {
      expect(backup.query("SELECT value FROM example").get()).toEqual({
        value: "preserved",
      });
    } finally {
      backup.close();
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports the most recent backup without exposing a mutable status object", () => {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-backup-manager-"));
  const database = new Database(join(directory, "source.sqlite"), {
    create: true,
    strict: true,
  });
  try {
    database.exec("CREATE TABLE example(value INTEGER)");
    const manager = createSqliteBackupManager({
      database,
      directory: join(directory, "backups"),
      retentionCount: 7,
      now: () => new Date("2026-07-26T08:00:00Z"),
    });
    manager.runNow();
    const first = manager.status();
    first.lastError = "mutated";
    expect(manager.status().lastFilename).toMatch(/^app-/);
    expect(manager.status().lastError).toBeUndefined();
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

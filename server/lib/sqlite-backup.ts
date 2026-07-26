import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

export type SqliteBackupStatus = {
  enabled: boolean;
  directory: string;
  retentionCount: number;
  intervalHours: number;
  lastAttemptAt?: number;
  lastCompletedAt?: number;
  lastFilename?: string;
  lastBytes?: number;
  lastError?: string;
  nextRunAt?: number;
};

type BackupManagerOptions = {
  database: Database;
  directory: string;
  enabled?: boolean;
  retentionCount?: number;
  intervalMs?: number;
  startDelayMs?: number;
  now?: () => Date;
};

export function createSqliteBackupManager(options: BackupManagerOptions) {
  const enabled = options.enabled !== false;
  const directory = resolve(options.directory);
  const retentionCount = Math.max(2, Math.floor(options.retentionCount || 14));
  const intervalMs = Math.max(
    60_000,
    Math.floor(options.intervalMs || 24 * 60 * 60_000),
  );
  const startDelayMs = Math.max(
    1_000,
    Math.floor(options.startDelayMs || 60_000),
  );
  const now = options.now || (() => new Date());
  const latest = enabled ? latestBackup(directory) : undefined;
  const status: SqliteBackupStatus = {
    enabled,
    directory,
    retentionCount,
    intervalHours: Math.round((intervalMs / 60 / 60_000) * 10) / 10,
    lastCompletedAt: latest?.createdAt,
    lastFilename: latest?.filename,
    lastBytes: latest?.bytes,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const schedule = (delayMs: number) => {
    status.nextRunAt = now().getTime() + delayMs;
    timer = setTimeout(() => {
      runNow();
      schedule(intervalMs);
    }, delayMs);
  };

  const runNow = () => {
    if (!enabled || running) return status;
    running = true;
    status.lastAttemptAt = now().getTime();
    try {
      const backup = createSqliteBackup(
        options.database,
        directory,
        retentionCount,
        now(),
      );
      status.lastCompletedAt = backup.createdAt;
      status.lastFilename = backup.filename;
      status.lastBytes = backup.bytes;
      status.lastError = undefined;
    } catch (error) {
      status.lastError =
        error instanceof Error ? error.message : "SQLite 备份失败";
    } finally {
      running = false;
    }
    return status;
  };

  return {
    start() {
      if (!enabled || timer) return;
      const elapsed = latest
        ? Math.max(0, now().getTime() - latest.createdAt)
        : intervalMs;
      schedule(
        latest ? Math.max(startDelayMs, intervalMs - elapsed) : startDelayMs,
      );
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      status.nextRunAt = undefined;
    },
    runNow,
    status: () => ({ ...status }),
  };
}

export function createSqliteBackup(
  database: Database,
  directory: string,
  retentionCount = 14,
  createdAt = new Date(),
) {
  mkdirSync(directory, { recursive: true });
  const timestamp = createdAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const filename = `app-${timestamp}-${createdAt.getTime()}.sqlite`;
  const target = join(directory, filename);
  const temporary = `${target}.tmp`;

  try {
    database.query("VACUUM INTO ?").run(temporary);
    verifyBackup(temporary);
    renameSync(temporary, target);
    pruneBackups(directory, retentionCount);
    return {
      filename,
      path: target,
      bytes: statSync(target).size,
      createdAt: createdAt.getTime(),
    };
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function verifyBackup(path: string) {
  const backup = new Database(path, { readonly: true, strict: true });
  try {
    const row = backup.query("PRAGMA quick_check").get() as Record<
      string,
      unknown
    > | null;
    if (String(Object.values(row || {})[0] || "") !== "ok")
      throw new Error("SQLite 备份完整性检查失败");
  } finally {
    backup.close();
  }
}

function pruneBackups(directory: string, retentionCount: number) {
  const files = listBackups(directory);
  for (const backup of files.slice(Math.max(2, retentionCount)))
    rmSync(backup.path, { force: true });
}

function latestBackup(directory: string) {
  return listBackups(directory)[0];
}

function listBackups(directory: string) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^app-\d{8}T\d{6}Z-\d+\.sqlite$/.test(entry.name),
    )
    .map((entry) => {
      const path = join(directory, entry.name);
      const stat = statSync(path);
      return {
        filename: basename(path),
        path,
        bytes: stat.size,
        createdAt: stat.mtimeMs,
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

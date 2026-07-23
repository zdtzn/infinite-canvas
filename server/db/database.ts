import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

import { decodeImageDataUrl } from "../lib/image-mime";
import type {
  ImageJobInput,
  ServerState,
  StoredImageJob,
  StoredImageReference,
} from "../types";

export type AppDatabase = {
  mode: "sqlite" | "legacy";
  loadState(): ServerState;
  saveState(state: ServerState): void;
  countRows(table: string): number;
  pragma(name: string): string | number;
  transaction<T>(operation: () => T): T;
  raw: Database | null;
  close(): void;
};

export function openAppDatabase({ dataDir }: { dataDir: string }): AppDatabase {
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, "app.sqlite");
  const statePath = join(dataDir, "state.json");
  const firstMigration = !existsSync(databasePath) && existsSync(statePath);
  let database: Database | null = null;
  try {
    database = new Database(databasePath, { create: true, strict: true });
    configure(database);
    createSchema(database);
    if (firstMigration) migrateLegacyState(database, dataDir, statePath);
    runMigrations(database);
    return sqliteStore(database);
  } catch (error) {
    database?.close();
    if (firstMigration)
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(`${databasePath}${suffix}`, { force: true });
    throw error;
  }
}

function configure(database: Database) {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA synchronous = NORMAL");
}

function createSchema(database: Database) {
  database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS app_auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_code_hash TEXT NOT NULL, session_secret TEXT NOT NULL, admin_user_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'NORMAL', created_at INTEGER NOT NULL, login_hash TEXT,
            internal_note TEXT NOT NULL DEFAULT '', public_message TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS channels (id TEXT NOT NULL, user_id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (user_id, id), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS assets (asset_key TEXT NOT NULL, user_id TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, asset_key), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS projects (user_id TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, project_id), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS project_tombstones (user_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY (user_id, project_id), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS realms (id TEXT PRIMARY KEY, theme_key TEXT NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, color TEXT NOT NULL, icon_key TEXT NOT NULL, animation_preset TEXT NOT NULL, sort_order INTEGER NOT NULL, daily_limit INTEGER, max_concurrency INTEGER NOT NULL, promotion_policy TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS realm_stages (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, name TEXT NOT NULL, stage_order INTEGER NOT NULL UNIQUE, required_xp INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (realm_id) REFERENCES realms(id));
        CREATE TABLE IF NOT EXISTS user_cultivation (user_id TEXT PRIMARY KEY, stage_id TEXT NOT NULL, current_xp INTEGER NOT NULL DEFAULT 0, total_xp INTEGER NOT NULL DEFAULT 0, daily_limit_override INTEGER, unlimited_quota INTEGER NOT NULL DEFAULT 0, pending_stage_id TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE, FOREIGN KEY (stage_id) REFERENCES realm_stages(id), FOREIGN KEY (pending_stage_id) REFERENCES realm_stages(id));
        CREATE TABLE IF NOT EXISTS cultivation_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, event_type TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, operator_user_id TEXT, reason TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, UNIQUE (user_id, source_type, source_id), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS daily_usage (user_id TEXT NOT NULL, usage_date TEXT NOT NULL, reserved_count INTEGER NOT NULL DEFAULT 0, used_count INTEGER NOT NULL DEFAULT 0, refunded_count INTEGER NOT NULL DEFAULT 0, successful_images INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, usage_date), FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS generation_usage (job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, usage_date TEXT NOT NULL, model TEXT NOT NULL, channel_id TEXT NOT NULL, reward_type TEXT NOT NULL DEFAULT 'standard', requested_count INTEGER NOT NULL, success_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, estimated_cost_micros INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, settled_at INTEGER, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS capability_definitions (capability_key TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS stage_capabilities (stage_id TEXT NOT NULL, capability_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (stage_id, capability_key), FOREIGN KEY (stage_id) REFERENCES realm_stages(id) ON DELETE CASCADE, FOREIGN KEY (capability_key) REFERENCES capability_definitions(capability_key) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS breakthrough_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, from_stage_id TEXT NOT NULL, to_stage_id TEXT NOT NULL, status TEXT NOT NULL, approved_by TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, seen_at INTEGER, FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS admin_audit_logs (id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL, target_user_id TEXT, action TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS login_logs (id TEXT PRIMARY KEY, user_id TEXT, display_name TEXT NOT NULL, result TEXT NOT NULL, ip_hash TEXT NOT NULL, ip_display TEXT NOT NULL, user_agent TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS cultivation_settings (setting_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON cultivation_ledger(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_generation_user_created ON generation_usage(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_login_created ON login_logs(created_at DESC);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ${Date.now()});
  `);
}

function runMigrations(database: Database) {
  const alreadyApplied = database
    .query("SELECT 1 FROM schema_migrations WHERE version = 2")
    .get();
  if (alreadyApplied) return;
  database.transaction(() => {
    const emperorStage = database
      .query("SELECT id FROM realm_stages WHERE id = ?")
      .get("realm-dou-emperor-1");
    if (emperorStage) {
      database
        .query("UPDATE realm_stages SET name = ?, active = 1 WHERE id = ?")
        .run("斗帝", "realm-dou-emperor-1");
      database
        .query(
          "UPDATE realm_stages SET active = 0 WHERE realm_id = ? AND id <> ?",
        )
        .run("realm-dou-emperor", "realm-dou-emperor-1");
      database
        .query(
          "UPDATE user_cultivation SET stage_id = ? WHERE stage_id LIKE ? AND stage_id <> ?",
        )
        .run(
          "realm-dou-emperor-1",
          "realm-dou-emperor-%",
          "realm-dou-emperor-1",
        );
      database
        .query(
          "UPDATE user_cultivation SET pending_stage_id = NULL WHERE pending_stage_id LIKE ? AND pending_stage_id <> ?",
        )
        .run("realm-dou-emperor-%", "realm-dou-emperor-1");
    }
    database
      .query("INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)")
      .run(Date.now());
  })();
}

function migrateLegacyState(
  database: Database,
  dataDir: string,
  statePath: string,
) {
  const backupPath = `${statePath}.backup`;
  if (!existsSync(backupPath)) copyFileSync(statePath, backupPath);
  const state = normalizeState(
    JSON.parse(readFileSync(statePath, "utf8")) as ServerState,
  );
  const migrated = migrateJobReferences(state, dataDir);
  replaceState(database, migrated);
  const expected = {
    users: Object.keys(migrated.users).length,
    channels: Object.keys(migrated.channels).length,
    assets: Object.keys(migrated.assets).length,
    jobs: Object.keys(migrated.jobs).length,
    projects: Object.values(migrated.projects).reduce(
      (total, projects) => total + Object.keys(projects).length,
      0,
    ),
  };
  for (const [table, count] of Object.entries(expected)) {
    const actual = Number(
      (
        database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count,
    );
    if (actual !== count)
      throw new Error(
        `Legacy migration count mismatch for ${table}: ${actual} !== ${count}`,
      );
  }
}

function migrateJobReferences(state: ServerState, dataDir: string) {
  for (const job of Object.values(state.jobs)) {
    job.input.references = job.input.references.map((reference, index) => {
      if (typeof reference !== "string" || !reference.startsWith("data:image/"))
        return reference;
      return persistReference(
        dataDir,
        job.input.userId,
        job.id,
        index,
        reference,
      );
    });
    if (
      typeof job.input.mask === "string" &&
      job.input.mask.startsWith("data:image/")
    )
      job.input.mask = persistReference(
        dataDir,
        job.input.userId,
        job.id,
        10_000,
        job.input.mask,
      );
  }
  return state;
}

export function persistReference(
  dataDir: string,
  userId: string,
  jobId: string,
  index: number,
  dataUrl: string,
): StoredImageReference {
  const { bytes, mimeType } = decodeImageDataUrl(dataUrl);
  const extension = mimeExtension(mimeType);
  const relativePath = join(
    "job-references",
    safeSegment(userId),
    safeSegment(jobId),
    `${index}.${extension}`,
  );
  const absolutePath = join(dataDir, relativePath);
  mkdirSync(
    join(dataDir, "job-references", safeSegment(userId), safeSegment(jobId)),
    { recursive: true },
  );
  writeFileSync(absolutePath, bytes);
  return {
    path: relativePath.replaceAll("\\", "/"),
    mimeType,
    bytes: bytes.byteLength,
  };
}

function sqliteStore(database: Database): AppDatabase {
  return {
    mode: "sqlite",
    raw: database,
    loadState: () => loadState(database),
    saveState: (state) => replaceState(database, state),
    countRows: (table) =>
      Number(
        (
          database
            .query(`SELECT COUNT(*) AS count FROM ${safeTable(table)}`)
            .get() as { count: number }
        ).count,
      ),
    pragma: (name) => {
      const row = database.query(`PRAGMA ${safePragma(name)}`).get() as Record<
        string,
        string | number
      >;
      return Object.values(row)[0];
    },
    transaction: (operation) => database.transaction(operation)(),
    close: () => database.close(),
  };
}

function replaceState(database: Database, state: ServerState) {
  // State snapshots created before project tombstones existed are still valid.
  // Treat the missing field as empty instead of failing an otherwise atomic write.
  const projectTombstones = state.projectTombstones || {};
  database.transaction(() => {
    database
      .query(
        "INSERT INTO app_auth(id, access_code_hash, session_secret, admin_user_id) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET access_code_hash=excluded.access_code_hash, session_secret=excluded.session_secret, admin_user_id=excluded.admin_user_id WHERE app_auth.access_code_hash IS NOT excluded.access_code_hash OR app_auth.session_secret IS NOT excluded.session_secret OR app_auth.admin_user_id IS NOT excluded.admin_user_id",
      )
      .run(
        state.auth.accessCodeHash,
        state.auth.sessionSecret,
        state.auth.adminUserId,
      );
    const insertUser = database.query(
      "INSERT INTO users(user_id, display_name, is_admin, status, created_at, login_hash, internal_note, public_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, is_admin=excluded.is_admin, status=excluded.status, login_hash=excluded.login_hash, internal_note=excluded.internal_note, public_message=excluded.public_message WHERE users.display_name IS NOT excluded.display_name OR users.is_admin IS NOT excluded.is_admin OR users.status IS NOT excluded.status OR users.login_hash IS NOT excluded.login_hash OR users.internal_note IS NOT excluded.internal_note OR users.public_message IS NOT excluded.public_message",
    );
    for (const user of Object.values(state.users))
      insertUser.run(
        user.userId,
        user.displayName,
        user.admin ? 1 : 0,
        user.status || (user.disabled ? "DISABLED" : "NORMAL"),
        user.createdAt,
        user.loginHash || null,
        user.internalNote || "",
        user.publicMessage || "",
      );
    const insertChannel = database.query(
      "INSERT INTO channels(id, user_id, payload_json) VALUES (?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET payload_json=excluded.payload_json WHERE channels.payload_json IS NOT excluded.payload_json",
    );
    for (const channel of Object.values(state.channels))
      insertChannel.run(channel.id, channel.userId, JSON.stringify(channel));
    const insertAsset = database.query(
      "INSERT INTO assets(asset_key, user_id, mime_type, bytes, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, asset_key) DO UPDATE SET mime_type=excluded.mime_type, bytes=excluded.bytes, created_at=excluded.created_at WHERE assets.mime_type IS NOT excluded.mime_type OR assets.bytes IS NOT excluded.bytes OR assets.created_at IS NOT excluded.created_at",
    );
    for (const asset of Object.values(state.assets))
      insertAsset.run(
        asset.key,
        asset.userId,
        asset.mimeType,
        asset.bytes,
        asset.createdAt,
      );
    const insertJob = database.query(
      "INSERT INTO jobs(id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, payload_json=excluded.payload_json, created_at=excluded.created_at WHERE jobs.user_id IS NOT excluded.user_id OR jobs.payload_json IS NOT excluded.payload_json OR jobs.created_at IS NOT excluded.created_at",
    );
    for (const job of Object.values(state.jobs))
      insertJob.run(
        job.id,
        job.input.userId,
        JSON.stringify(job),
        job.createdAt,
      );
    const insertProject = database.query(
      "INSERT INTO projects(user_id, project_id, payload_json, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, project_id) DO UPDATE SET payload_json=excluded.payload_json, revision=excluded.revision, updated_at=excluded.updated_at WHERE projects.payload_json IS NOT excluded.payload_json OR projects.revision IS NOT excluded.revision OR projects.updated_at IS NOT excluded.updated_at",
    );
    for (const [userId, projects] of Object.entries(state.projects))
      for (const [projectId, project] of Object.entries(projects))
        insertProject.run(
          userId,
          projectId,
          JSON.stringify(project.project),
          project.revision,
          project.updatedAt,
        );
    const deleteChannel = database.query("DELETE FROM channels WHERE user_id = ? AND id = ?");
    for (const row of database.query("SELECT user_id, id FROM channels").all() as Array<{ user_id: string; id: string }>)
      if (!state.channels[`${row.user_id}:${row.id}`]) deleteChannel.run(row.user_id, row.id);
    const deleteAsset = database.query("DELETE FROM assets WHERE user_id = ? AND asset_key = ?");
    for (const row of database.query("SELECT user_id, asset_key FROM assets").all() as Array<{ user_id: string; asset_key: string }>)
      if (!state.assets[`${row.user_id}:${row.asset_key}`]) deleteAsset.run(row.user_id, row.asset_key);
    const deleteJob = database.query("DELETE FROM jobs WHERE id = ?");
    for (const row of database.query("SELECT id FROM jobs").all() as Array<{ id: string }>)
      if (!state.jobs[row.id]) deleteJob.run(row.id);
    const deleteProject = database.query("DELETE FROM projects WHERE user_id = ? AND project_id = ?");
    for (const row of database.query("SELECT user_id, project_id FROM projects").all() as Array<{ user_id: string; project_id: string }>)
      if (!state.projects[row.user_id]?.[row.project_id]) deleteProject.run(row.user_id, row.project_id);
    const insertProjectTombstone = database.query(
      "INSERT INTO project_tombstones(user_id, project_id, revision, deleted_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, project_id) DO UPDATE SET revision=excluded.revision, deleted_at=excluded.deleted_at WHERE project_tombstones.revision IS NOT excluded.revision OR project_tombstones.deleted_at IS NOT excluded.deleted_at",
    );
    for (const [userId, tombstones] of Object.entries(projectTombstones))
      for (const [projectId, tombstone] of Object.entries(tombstones))
        insertProjectTombstone.run(userId, projectId, tombstone.revision, tombstone.deletedAt);
    const deleteProjectTombstone = database.query("DELETE FROM project_tombstones WHERE user_id = ? AND project_id = ?");
    for (const row of database.query("SELECT user_id, project_id FROM project_tombstones").all() as Array<{ user_id: string; project_id: string }>)
      if (!projectTombstones[row.user_id]?.[row.project_id]) deleteProjectTombstone.run(row.user_id, row.project_id);
    const deleteUser = database.query("DELETE FROM users WHERE user_id = ?");
    for (const row of database.query("SELECT user_id FROM users").all() as Array<{ user_id: string }>)
      if (!state.users[row.user_id]) deleteUser.run(row.user_id);
  })();
}

function loadState(database: Database): ServerState {
  const auth = (database
    .query(
      "SELECT access_code_hash, session_secret, admin_user_id FROM app_auth WHERE id = 1",
    )
    .get() as {
    access_code_hash: string;
    session_secret: string;
    admin_user_id: string;
  } | null) || {
    access_code_hash: "",
    session_secret: crypto.randomUUID(),
    admin_user_id: "",
  };
  const users: ServerState["users"] = {};
  for (const row of database.query("SELECT * FROM users").all() as Array<
    Record<string, unknown>
  >)
    users[String(row.user_id)] = {
      userId: String(row.user_id),
      displayName: String(row.display_name),
      admin: Boolean(row.is_admin),
      status: String(row.status) as "NORMAL" | "DISABLED" | "BANNED",
      disabled: row.status !== "NORMAL",
      createdAt: Number(row.created_at),
      loginHash: row.login_hash ? String(row.login_hash) : undefined,
      internalNote: String(row.internal_note || ""),
      publicMessage: String(row.public_message || ""),
    };
  const channels: ServerState["channels"] = {};
  for (const row of database
    .query("SELECT payload_json FROM channels")
    .all() as Array<{ payload_json: string }>) {
    const channel = JSON.parse(row.payload_json);
    channels[`${channel.userId}:${channel.id}`] = channel;
  }
  const assets: ServerState["assets"] = {};
  for (const row of database.query("SELECT * FROM assets").all() as Array<
    Record<string, unknown>
  >)
    assets[`${row.user_id}:${row.asset_key}`] = {
      key: String(row.asset_key),
      userId: String(row.user_id),
      mimeType: String(row.mime_type),
      bytes: Number(row.bytes),
      createdAt: Number(row.created_at),
    };
  const jobs: ServerState["jobs"] = {};
  for (const row of database
    .query("SELECT payload_json FROM jobs")
    .all() as Array<{ payload_json: string }>) {
    const job = JSON.parse(row.payload_json) as StoredImageJob;
    jobs[job.id] = job;
  }
  const projects: ServerState["projects"] = {};
  for (const row of database.query("SELECT * FROM projects").all() as Array<
    Record<string, unknown>
  >)
    (projects[String(row.user_id)] ||= {})[String(row.project_id)] = {
      project: JSON.parse(String(row.payload_json)),
      revision: Number(row.revision),
      updatedAt: Number(row.updated_at),
    };
  const projectTombstones: ServerState["projectTombstones"] = {};
  for (const row of database.query("SELECT * FROM project_tombstones").all() as Array<Record<string, unknown>>)
    (projectTombstones[String(row.user_id)] ||= {})[String(row.project_id)] = {
      revision: Number(row.revision),
      deletedAt: Number(row.deleted_at),
    };
  return {
    version: 1,
    auth: {
      accessCodeHash: auth.access_code_hash,
      sessionSecret: auth.session_secret,
      adminUserId: auth.admin_user_id,
    },
    users,
    channels,
    assets,
    jobs,
    projects,
    projectTombstones,
  };
}

function normalizeState(state: ServerState): ServerState {
  state.users ||= {};
  state.channels ||= {};
  state.assets ||= {};
  state.jobs ||= {};
  state.projects ||= {};
  state.projectTombstones ||= {};
  return state;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "item";
}

function safeTable(value: string) {
  if (!/^[a-z_]+$/i.test(value)) throw new Error("Invalid table name");
  return value;
}

function safePragma(value: string) {
  if (!/^[a-z_]+$/i.test(value)) throw new Error("Invalid pragma name");
  return value;
}

function mimeExtension(mimeType: string) {
  return (
    (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/avif": "avif",
      } as Record<string, string>
    )[mimeType] ||
    extname(mimeType) ||
    "bin"
  );
}

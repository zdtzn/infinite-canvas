import type { Database } from "bun:sqlite";

export type MediaTaskKind = "video" | "content";

export type MediaTaskOwnership = {
    usageId: string;
    userId: string;
    channelId: string;
    kind: MediaTaskKind;
    taskId: string;
    createdAt: number;
    status: "active" | "finished";
    finishedAt: number | null;
};

export function createMediaTaskStore(database: Database, retentionMs = 30 * 24 * 60 * 60_000, activeTtlMs = 2 * 60 * 60_000) {
    const findByUsage = database.query(
        "SELECT usage_id, user_id, channel_id, task_kind, task_id, created_at, task_status, finished_at FROM media_task_ownership WHERE usage_id = ?",
    );
    const findByTask = database.query(
        "SELECT usage_id, user_id, channel_id, task_kind, task_id, created_at, task_status, finished_at FROM media_task_ownership WHERE channel_id = ? AND task_kind = ? AND task_id = ?",
    );
    const insert = database.query(
        "INSERT OR IGNORE INTO media_task_ownership(usage_id, user_id, channel_id, task_kind, task_id, created_at, task_status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
    );
    const finish = database.query(
        "UPDATE media_task_ownership SET task_status = 'finished', finished_at = COALESCE(finished_at, ?) WHERE channel_id = ? AND task_kind = ? AND task_id = ?",
    );
    const expire = database.query(
        "UPDATE media_task_ownership SET task_status = 'finished', finished_at = COALESCE(finished_at, ?) WHERE task_status = 'active' AND created_at < ?",
    );
    const countActive = database.query(
        "SELECT COUNT(*) AS count FROM media_task_ownership WHERE user_id = ? AND task_status = 'active' AND created_at >= ?",
    );
    const prune = database.query("DELETE FROM media_task_ownership WHERE created_at < ?");

    function register(input: Omit<MediaTaskOwnership, "createdAt" | "status" | "finishedAt"> & { createdAt?: number }) {
        const record = normalizeOwnership({ ...input, createdAt: input.createdAt || Date.now(), status: "active", finishedAt: null });
        return database.transaction(() => {
            pruneExpired(record.createdAt);
            insert.run(record.usageId, record.userId, record.channelId, record.kind, record.taskId, record.createdAt);
            const byUsage = readOwnership(findByUsage.get(record.usageId));
            const byTask = readOwnership(findByTask.get(record.channelId, record.kind, record.taskId));
            if (!sameOwnership(byUsage, record) || !sameOwnership(byTask, record)) throw new Error("媒体任务归属记录发生冲突");
            return record;
        })();
    }

    function getByUsageId(usageId: string) {
        return readOwnership(findByUsage.get(usageId));
    }

    function isOwnedBy(userId: string, channelId: string, kind: MediaTaskKind, taskId: string) {
        const record = readOwnership(findByTask.get(channelId, kind, taskId));
        return Boolean(record && record.userId === userId);
    }

    function markFinished(channelId: string, kind: MediaTaskKind, taskId: string, now = Date.now()) {
        finish.run(Math.max(0, Math.floor(now)), channelId, kind, taskId);
    }

    function countActiveForUser(userId: string, now = Date.now()) {
        pruneExpired(now);
        const row = countActive.get(userId, now - Math.max(60_000, activeTtlMs)) as { count: number } | null;
        return Number(row?.count || 0);
    }

    function pruneExpired(now: number) {
        const timestamp = Math.max(0, Math.floor(now));
        expire.run(timestamp, timestamp - Math.max(60_000, activeTtlMs));
        prune.run(timestamp - Math.max(24 * 60 * 60_000, retentionMs));
    }

    return {
        register,
        getByUsageId,
        isOwnedBy,
        markFinished,
        countActiveForUser,
        prune: (now = Date.now()) => pruneExpired(now),
    };
}

function normalizeOwnership(value: MediaTaskOwnership): MediaTaskOwnership {
    const usageId = bounded(value.usageId, 128, "媒体用量标识无效");
    const userId = bounded(value.userId, 128, "媒体任务用户无效");
    const channelId = bounded(value.channelId, 180, "媒体任务渠道无效");
    const taskId = bounded(value.taskId, 512, "媒体任务标识无效");
    if (value.kind !== "video" && value.kind !== "content") throw new Error("媒体任务类型无效");
    const status = value.status === "finished" ? "finished" : "active";
    return {
        usageId,
        userId,
        channelId,
        kind: value.kind,
        taskId,
        createdAt: Math.max(0, Math.floor(value.createdAt)),
        status,
        finishedAt: status === "finished" && value.finishedAt != null ? Math.max(0, Math.floor(value.finishedAt)) : null,
    };
}

function bounded(value: string, maxLength: number, message: string) {
    const result = String(value || "").trim();
    if (!result || result.length > maxLength || /\p{C}/u.test(result)) throw new Error(message);
    return result;
}

function readOwnership(value: unknown): MediaTaskOwnership | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    return {
        usageId: String(row.usage_id),
        userId: String(row.user_id),
        channelId: String(row.channel_id),
        kind: String(row.task_kind) as MediaTaskKind,
        taskId: String(row.task_id),
        createdAt: Number(row.created_at),
        status: row.task_status === "finished" ? "finished" : "active",
        finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    };
}

function sameOwnership(left: MediaTaskOwnership | null, right: MediaTaskOwnership) {
    return Boolean(left && left.usageId === right.usageId && left.userId === right.userId && left.channelId === right.channelId && left.kind === right.kind && left.taskId === right.taskId);
}

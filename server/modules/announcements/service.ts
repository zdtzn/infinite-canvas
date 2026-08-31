import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

export type AnnouncementType = "update" | "notice" | "maintenance";
export type AnnouncementStatus = "draft" | "published" | "archived";

export type Announcement = {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: AnnouncementType;
  status: AnnouncementStatus;
  pinned: boolean;
  authorUserId: string;
  authorName: string;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  isRead?: boolean;
  readAt?: number | null;
};

export type AnnouncementInput = {
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  type?: unknown;
  status?: unknown;
  pinned?: unknown;
};

export class AnnouncementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "ANNOUNCEMENT_INVALID",
  ) {
    super(message);
    this.name = "AnnouncementError";
  }
}

export function createAnnouncementService(
  database: Database,
  options: { now?: () => number } = {},
) {
  const now = options.now || Date.now;

  function listPublished(
    userId: string,
    options: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
  ) {
    const timestamp = now();
    const { page, pageSize, offset } = pagination(
      options.page,
      options.pageSize,
    );
    const unreadClause = options.unreadOnly
      ? " AND r.announcement_id IS NULL"
      : "";
    const params: Array<string | number> = [userId, timestamp];
    const count = database
      .query(
        `SELECT COUNT(*) AS value
         FROM system_announcements a
         LEFT JOIN announcement_reads r
           ON r.announcement_id = a.id AND r.user_id = ?
         WHERE a.status = 'published' AND a.published_at IS NOT NULL AND a.published_at <= ?${unreadClause}`,
      )
      .get(...params) as { value: number };
    const rows = database
      .query(
        `SELECT a.*, u.display_name AS author_name, r.read_at
         FROM system_announcements a
         JOIN users u ON u.user_id = a.author_user_id
         LEFT JOIN announcement_reads r
           ON r.announcement_id = a.id AND r.user_id = ?
         WHERE a.status = 'published' AND a.published_at IS NOT NULL AND a.published_at <= ?${unreadClause}
         ORDER BY a.pinned DESC, a.published_at DESC, a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as AnnouncementRow[];
    const unread = database
      .query(
        `SELECT COUNT(*) AS value
         FROM system_announcements a
         LEFT JOIN announcement_reads r
           ON r.announcement_id = a.id AND r.user_id = ?
         WHERE a.status = 'published' AND a.published_at IS NOT NULL AND a.published_at <= ? AND r.announcement_id IS NULL`,
      )
      .get(userId, timestamp) as { value: number };
    return {
      items: rows.map((row) => announcementFromRow(row, true)),
      page,
      pageSize,
      total: Number(count.value || 0),
      unreadCount: Number(unread.value || 0),
    };
  }

  function listAdmin(
    options: {
      page?: number;
      pageSize?: number;
      search?: string;
      type?: string;
      status?: string;
    } = {},
  ) {
    const { page, pageSize, offset } = pagination(
      options.page,
      options.pageSize,
    );
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    const search = String(options.search || "").trim();
    const type = optionalType(options.type);
    const status = optionalStatus(options.status);
    if (search) {
      conditions.push(
        "(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')",
      );
      const pattern = `%${escapeSqlLike(search)}%`;
      params.push(pattern, pattern, pattern);
    }
    if (type) {
      conditions.push("a.type = ?");
      params.push(type);
    }
    if (status) {
      conditions.push("a.status = ?");
      params.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = database
      .query(`SELECT COUNT(*) AS value FROM system_announcements a ${where}`)
      .get(...params) as { value: number };
    const rows = database
      .query(
        `SELECT a.*, u.display_name AS author_name, NULL AS read_at
         FROM system_announcements a
         JOIN users u ON u.user_id = a.author_user_id
         ${where}
         ORDER BY CASE a.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                  a.pinned DESC, COALESCE(a.published_at, a.updated_at) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as AnnouncementRow[];
    return {
      items: rows.map((row) => announcementFromRow(row, false)),
      page,
      pageSize,
      total: Number(count.value || 0),
    };
  }

  function create(adminUserId: string, input: AnnouncementInput) {
    const timestamp = now();
    const normalized = normalizeInput(input);
    const id = randomUUID();
    const publishedAt = normalized.status === "published" ? timestamp : null;
    database.transaction(() => {
      database
        .query(
          `INSERT INTO system_announcements(
             id, title, summary, content, type, status, pinned, author_user_id,
             published_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          normalized.title,
          normalized.summary,
          normalized.content,
          normalized.type,
          normalized.status,
          normalized.pinned ? 1 : 0,
          adminUserId,
          publishedAt,
          timestamp,
          timestamp,
        );
      writeAudit(
        database,
        adminUserId,
        "announcement.create",
        "创建系统公告",
        {},
        {
          id,
          ...auditSnapshot(normalized, publishedAt),
        },
        timestamp,
      );
    })();
    return requireAnnouncement(id);
  }

  function update(
    adminUserId: string,
    announcementId: string,
    input: AnnouncementInput,
  ) {
    const id = validId(announcementId);
    const before = requireAnnouncement(id);
    const normalized = normalizeInput(input, before);
    const timestamp = now();
    const resetReads =
      normalized.status === "published" &&
      (before.status !== "published" ||
        before.title !== normalized.title ||
        before.summary !== normalized.summary ||
        before.content !== normalized.content ||
        before.type !== normalized.type);
    const publishedAt =
      normalized.status === "published"
        ? before.status === "published" &&
          before.publishedAt !== null &&
          !resetReads
          ? before.publishedAt
          : timestamp
        : before.publishedAt;

    database.transaction(() => {
      database
        .query(
          `UPDATE system_announcements
           SET title = ?, summary = ?, content = ?, type = ?, status = ?, pinned = ?,
               published_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          normalized.title,
          normalized.summary,
          normalized.content,
          normalized.type,
          normalized.status,
          normalized.pinned ? 1 : 0,
          publishedAt,
          timestamp,
          id,
        );
      if (resetReads)
        database
          .query("DELETE FROM announcement_reads WHERE announcement_id = ?")
          .run(id);
      const action =
        normalized.status === "archived" && before.status !== "archived"
          ? "announcement.archive"
          : before.status !== "published" && normalized.status === "published"
            ? "announcement.publish"
            : "announcement.update";
      const reason =
        action === "announcement.archive"
          ? "归档系统公告"
          : action === "announcement.publish"
            ? "发布系统公告"
            : "更新系统公告";
      writeAudit(
        database,
        adminUserId,
        action,
        reason,
        { id, ...auditSnapshot(before, before.publishedAt) },
        { id, ...auditSnapshot(normalized, publishedAt) },
        timestamp,
      );
    })();
    return requireAnnouncement(id);
  }

  function markRead(userId: string, announcementId: string) {
    const id = validId(announcementId);
    const visible = database
      .query(
        "SELECT 1 FROM system_announcements WHERE id = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?",
      )
      .get(id, now());
    if (!visible)
      throw new AnnouncementError(
        "公告不存在或尚未发布",
        404,
        "ANNOUNCEMENT_NOT_FOUND",
      );
    const readAt = now();
    database
      .query(
        `INSERT INTO announcement_reads(user_id, announcement_id, read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, announcement_id) DO UPDATE SET read_at = excluded.read_at`,
      )
      .run(userId, id, readAt);
    return { id, readAt };
  }

  function markAllRead(userId: string) {
    const readAt = now();
    const result = database
      .query(
        `INSERT OR IGNORE INTO announcement_reads(user_id, announcement_id, read_at)
         SELECT ?, id, ? FROM system_announcements
         WHERE status = 'published' AND published_at IS NOT NULL AND published_at <= ?`,
      )
      .run(userId, readAt, readAt);
    return { readAt, count: Number(result.changes || 0) };
  }

  function listReadReceipts(userId: string) {
    return (
      database
        .query(
          `SELECT announcement_id, read_at
           FROM announcement_reads
           WHERE user_id = ?
           ORDER BY read_at DESC, announcement_id`,
        )
        .all(userId) as Array<{ announcement_id: string; read_at: number }>
    ).map((row) => ({
      announcementId: row.announcement_id,
      readAt: Number(row.read_at),
    }));
  }

  function requireAnnouncement(announcementId: string) {
    const id = validId(announcementId);
    const row = database
      .query(
        `SELECT a.*, u.display_name AS author_name, NULL AS read_at
         FROM system_announcements a
         JOIN users u ON u.user_id = a.author_user_id
         WHERE a.id = ?`,
      )
      .get(id) as AnnouncementRow | null;
    if (!row)
      throw new AnnouncementError("公告不存在", 404, "ANNOUNCEMENT_NOT_FOUND");
    return announcementFromRow(row, false);
  }

  return {
    listPublished,
    listAdmin,
    create,
    update,
    markRead,
    markAllRead,
    listReadReceipts,
  };
}

type AnnouncementRow = {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: AnnouncementType;
  status: AnnouncementStatus;
  pinned: number;
  author_user_id: string;
  author_name: string;
  published_at: number | null;
  created_at: number;
  updated_at: number;
  read_at: number | null;
};

function announcementFromRow(
  row: AnnouncementRow,
  includeReadState: boolean,
): Announcement {
  const readAt = row.read_at == null ? null : Number(row.read_at);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    type: row.type,
    status: row.status,
    pinned: Boolean(row.pinned),
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(includeReadState ? { isRead: readAt !== null, readAt } : {}),
  };
}

function normalizeInput(input: AnnouncementInput, fallback?: Announcement) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AnnouncementError("公告内容无效");
  return {
    title:
      input.title === undefined && fallback
        ? fallback.title
        : requiredText(input.title, 2, 120, "公告标题"),
    summary:
      input.summary === undefined && fallback
        ? fallback.summary
        : optionalText(input.summary, 240, "公告摘要"),
    content:
      input.content === undefined && fallback
        ? fallback.content
        : paragraphText(input.content, 2, 8_000, "公告正文"),
    type:
      input.type === undefined && fallback
        ? fallback.type
        : requiredType(input.type),
    status:
      input.status === undefined && fallback
        ? fallback.status
        : requiredStatus(input.status),
    pinned:
      input.pinned === undefined
        ? (fallback?.pinned ?? false)
        : requiredBoolean(input.pinned),
  };
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") throw new AnnouncementError("置顶状态无效");
  return value;
}

function requiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
  label: string,
) {
  const text = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length < minLength)
    throw new AnnouncementError(`${label}至少需要 ${minLength} 个字符`);
  if (text.length > maxLength)
    throw new AnnouncementError(`${label}不能超过 ${maxLength} 个字符`);
  if (hasInvalidControl(text))
    throw new AnnouncementError(`${label}包含无效字符`);
  return text;
}

function optionalText(value: unknown, maxLength: number, label: string) {
  const text = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length > maxLength)
    throw new AnnouncementError(`${label}不能超过 ${maxLength} 个字符`);
  if (hasInvalidControl(text))
    throw new AnnouncementError(`${label}包含无效字符`);
  return text;
}

function paragraphText(
  value: unknown,
  minLength: number,
  maxLength: number,
  label: string,
) {
  const text = String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (text.length < minLength)
    throw new AnnouncementError(`${label}至少需要 ${minLength} 个字符`);
  if (text.length > maxLength)
    throw new AnnouncementError(`${label}不能超过 ${maxLength} 个字符`);
  if (hasInvalidControl(text, true))
    throw new AnnouncementError(`${label}包含无效字符`);
  return text;
}

function requiredType(value: unknown): AnnouncementType {
  const type = String(value || "").trim();
  if (type === "update" || type === "notice" || type === "maintenance")
    return type;
  throw new AnnouncementError("公告类型无效");
}

function optionalType(value: unknown) {
  const type = String(value || "").trim();
  return type ? requiredType(type) : undefined;
}

function requiredStatus(value: unknown): AnnouncementStatus {
  const status = String(value || "").trim();
  if (status === "draft" || status === "published" || status === "archived")
    return status;
  throw new AnnouncementError("公告状态无效");
}

function optionalStatus(value: unknown) {
  const status = String(value || "").trim();
  return status ? requiredStatus(status) : undefined;
}

function validId(value: unknown) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id))
    throw new AnnouncementError("公告 ID 无效");
  return id;
}

function pagination(pageValue: unknown, pageSizeValue: unknown) {
  const page = Math.max(1, Math.floor(Number(pageValue) || 1));
  const pageSize = Math.max(
    1,
    Math.min(50, Math.floor(Number(pageSizeValue) || 20)),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function auditSnapshot(
  value: Pick<
    Announcement,
    "title" | "summary" | "content" | "type" | "status" | "pinned"
  >,
  publishedAt: number | null,
) {
  return {
    title: value.title,
    type: value.type,
    status: value.status,
    pinned: value.pinned,
    publishedAt,
  };
}

function writeAudit(
  database: Database,
  adminUserId: string,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
  timestamp: number,
) {
  database
    .query(
      "INSERT INTO admin_audit_logs(id, admin_user_id, target_user_id, action, reason, before_json, after_json, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      adminUserId,
      action,
      reason,
      JSON.stringify(before || {}),
      JSON.stringify(after || {}),
      timestamp,
    );
}

function hasInvalidControl(value: string, allowParagraphs = false) {
  const pattern = allowParagraphs
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return pattern.test(value);
}

function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

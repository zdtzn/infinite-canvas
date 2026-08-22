import type { Database } from "bun:sqlite";

const MAX_INDEX_ITEMS_PER_SOURCE = 20_000;
const MAX_PROMPT_TEXT = 200_000;

export type PromptIndexItem = {
  id: string;
  title: string;
  coverUrl: string;
  prompt: string;
  tags: string[];
  preview: string;
  createdAt: string;
  updatedAt: string;
  category: string;
  githubUrl: string;
};

export type PromptIndexQuery = {
  keyword?: string;
  category?: string;
  tags?: string[];
  page?: number;
  pageSize?: number;
};

export type PromptIndexResult = {
  items: PromptIndexItem[];
  tags: string[];
  categories: string[];
  total: number;
  page: number;
  pageSize: number;
  indexed: boolean;
};

export function normalizePromptIndexItems(sourceId: string, input: unknown): PromptIndexItem[] {
  if (!Array.isArray(input)) throw new Error("提示词索引必须是数组");
  const normalizedSourceId = sourceId.trim().slice(0, 96);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(normalizedSourceId)) throw new Error("提示词来源 ID 无效");
  const seen = new Set<string>();
  const items: PromptIndexItem[] = [];
  for (const raw of input.slice(0, MAX_INDEX_ITEMS_PER_SOURCE)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = String(record.id || `prompt-${items.length + 1}`).trim().slice(0, 128);
    const title = String(record.title || "").trim().slice(0, 400);
    const prompt = String(record.prompt || "").trim().slice(0, MAX_PROMPT_TEXT);
    if (!id || !title || !prompt || seen.has(id)) continue;
    seen.add(id);
    const tags = Array.from(new Set((Array.isArray(record.tags) ? record.tags : []).map((tag) => String(tag || "").trim().slice(0, 80)).filter(Boolean))).slice(0, 40);
    items.push({
      id,
      title,
      prompt,
      coverUrl: safeUrl(record.coverUrl),
      preview: String(record.preview || "").slice(0, 80_000),
      tags,
      createdAt: safeDate(record.createdAt),
      updatedAt: safeDate(record.updatedAt),
      category: String(record.category || normalizedSourceId).trim().slice(0, 160) || normalizedSourceId,
      githubUrl: safeUrl(record.githubUrl),
    });
  }
  return items;
}

export function replacePromptIndex(database: Database, sourceId: string, items: PromptIndexItem[]) {
  const timestamp = Date.now();
  database.transaction(() => {
    database.query("DELETE FROM prompt_index WHERE source_id = ?").run(sourceId);
    const insert = database.query(
      "INSERT INTO prompt_index(source_id, prompt_id, title, prompt, cover_url, preview, tags_json, category, github_url, created_at, updated_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const item of items) {
      insert.run(sourceId, item.id, item.title, item.prompt, item.coverUrl, item.preview, JSON.stringify(item.tags), item.category, item.githubUrl, item.createdAt, item.updatedAt, timestamp);
    }
    database.query(
      "INSERT INTO prompt_index_status(source_id, count, last_success_at, last_error, updated_at) VALUES (?, ?, ?, '', ?) ON CONFLICT(source_id) DO UPDATE SET count=excluded.count, last_success_at=excluded.last_success_at, last_error='', updated_at=excluded.updated_at",
    ).run(sourceId, items.length, timestamp, timestamp);
  })();
}

export function recordPromptIndexError(database: Database, sourceId: string, error: string) {
  const timestamp = Date.now();
  database.query(
    "INSERT INTO prompt_index_status(source_id, count, last_success_at, last_error, updated_at) VALUES (?, 0, NULL, ?, ?) ON CONFLICT(source_id) DO UPDATE SET last_error=excluded.last_error, updated_at=excluded.updated_at",
  ).run(sourceId, error.slice(0, 500), timestamp);
}

export function queryPromptIndex(database: Database, options: PromptIndexQuery = {}): PromptIndexResult {
  const keyword = String(options.keyword || "").trim().toLowerCase();
  const category = String(options.category || "").trim();
  const tags = Array.isArray(options.tags) ? options.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 20) : [];
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
  const where = ["1 = 1"];
  const params: Array<string | number> = [];
  if (keyword) {
    where.push("lower(title || ' ' || prompt || ' ' || category || ' ' || tags_json) LIKE ?");
    params.push(`%${keyword}%`);
  }
  if (category && category !== "全部") {
    where.push("category = ?");
    params.push(category);
  }
  for (const tag of tags) {
    where.push("EXISTS (SELECT 1 FROM json_each(prompt_index.tags_json) WHERE json_each.value = ?)");
    params.push(tag);
  }
  const condition = where.join(" AND ");
  const totalRow = database.query(`SELECT COUNT(*) AS count FROM prompt_index WHERE ${condition}`).get(...params) as { count?: number };
  const rows = database.query(`SELECT * FROM prompt_index WHERE ${condition} ORDER BY indexed_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as PromptIndexRow[];
  const tagParams: Array<string | number> = [];
  const tagWhere = ["1 = 1"];
  if (keyword) {
    tagWhere.push("lower(title || ' ' || prompt || ' ' || category || ' ' || tags_json) LIKE ?");
    tagParams.push(`%${keyword}%`);
  }
  if (category && category !== "全部") {
    tagWhere.push("category = ?");
    tagParams.push(category);
  }
  const tagRows = database.query(`SELECT DISTINCT json_each.value AS tag FROM prompt_index, json_each(prompt_index.tags_json) WHERE ${tagWhere.join(" AND ")} ORDER BY tag COLLATE NOCASE`).all(...tagParams) as Array<{ tag?: string }>;
  const categoryRows = database.query("SELECT DISTINCT category FROM prompt_index WHERE category <> '' ORDER BY category COLLATE NOCASE").all() as Array<{ category?: string }>;
  return {
    items: rows.map(promptIndexRow),
    tags: tagRows.map((row) => String(row.tag || "")).filter(Boolean),
    categories: categoryRows.map((row) => String(row.category || "")).filter(Boolean),
    total: Number(totalRow?.count || 0),
    page,
    pageSize,
    indexed: Number(totalRow?.count || 0) > 0,
  };
}

export function promptIndexStatuses(database: Database) {
  return (database.query("SELECT source_id, count, last_success_at, last_error FROM prompt_index_status ORDER BY source_id").all() as PromptIndexStatusRow[]).map((row) => ({
    sourceId: row.source_id,
    count: Number(row.count || 0),
    lastSuccessAt: row.last_success_at ? new Date(Number(row.last_success_at)).toISOString() : "",
    lastError: String(row.last_error || ""),
  }));
}

type PromptIndexRow = {
  prompt_id: string;
  title: string;
  prompt: string;
  cover_url: string;
  preview: string;
  tags_json: string;
  category: string;
  github_url: string;
  created_at: string;
  updated_at: string;
};

type PromptIndexStatusRow = {
  source_id: string;
  count: number;
  last_success_at: number | null;
  last_error: string;
};

function promptIndexRow(row: PromptIndexRow): PromptIndexItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.map(String).filter(Boolean);
  } catch {
    tags = [];
  }
  return {
    id: row.prompt_id,
    title: row.title,
    prompt: row.prompt,
    coverUrl: row.cover_url,
    preview: row.preview,
    tags,
    category: row.category,
    githubUrl: row.github_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeUrl(value: unknown) {
  const text = String(value || "").trim().slice(0, 2_048);
  return /^(?:https?:\/\/|\/)/i.test(text) ? text : "";
}

function safeDate(value: unknown) {
  const text = String(value || "").trim();
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

import type { Database } from "bun:sqlite";
import { getPromptSearchText, getPromptUsage, mergePromptUsage, tokenizePromptKeyword, type PromptOrigin, type PromptUsage } from "../../shared/prompt-library";
import { classifyPromptTags, isPromptTaxonomyTag } from "./prompt-taxonomy";

const MAX_INDEX_ITEMS_PER_SOURCE = 20_000;
const MAX_PROMPT_TEXT = 200_000;

export type PromptIndexItem = {
  sourceId?: string;
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
  sourceTags?: string[];
  sources?: PromptOrigin[];
  usage?: PromptUsage;
};

export type PromptIndexQuery = {
  order?: "asc" | "desc" | "relevance";
  sourceId?: string;
  enabledSourceIds?: readonly string[];
  media?: Exclude<PromptUsage["media"], "general">;
  keyword?: string;
  category?: string;
  tags?: string[];
  page?: number;
  pageSize?: number;
};

export function queryPromptCovers(database: Database, sourceIds: string[]) {
  const items: Array<{ sourceId: string; id: string; title: string; coverUrl: string }> = [];
  const indexedSourceIds: string[] = [];
  const status = database.query("SELECT last_success_at FROM prompt_index_status WHERE source_id = ?");
  const covers = database.query("SELECT prompt_id AS id, title, cover_url AS coverUrl FROM prompt_index WHERE source_id = ? ORDER BY rowid ASC");
  for (const sourceId of new Set(sourceIds)) {
    const row = status.get(sourceId) as { last_success_at: number | null } | null;
    if (row?.last_success_at == null) continue;
    indexedSourceIds.push(sourceId);
    const rows = covers.all(sourceId) as Array<{ id: string; title: string; coverUrl: string }>;
    for (const item of rows) items.push({ sourceId, ...item });
  }
  return { items, indexedSourceIds };
}

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
    const rawTags = Array.isArray(record.sourceTags) && record.sourceTags.length ? record.sourceTags : record.tags;
    const sourceTags = Array.from(new Set((Array.isArray(rawTags) ? rawTags : []).map((tag) => String(tag || "").trim().slice(0, 80)).filter(Boolean))).slice(0, 40);
    const tags = classifyPromptTags({ title, prompt, tags: sourceTags });
    items.push({
      sourceId: normalizedSourceId,
      id,
      title,
      prompt,
      coverUrl: safeUrl(record.coverUrl),
      preview: String(record.preview || "").slice(0, 80_000),
      tags,
      sourceTags,
      usage: getPromptUsage({ title, prompt, tags: [...sourceTags, ...tags] }),
      createdAt: safeDate(record.createdAt),
      updatedAt: safeDate(record.updatedAt),
      category: String(record.category || normalizedSourceId).trim().slice(0, 160) || normalizedSourceId,
      githubUrl: safeUrl(record.githubUrl),
    });
  }
  return items;
}

export function normalizeStoredPromptIndexTaxonomy(database: Database) {
  const rows = database.query<StoredPromptTaxonomyRow, []>("SELECT source_id, prompt_id, title, prompt, tags_json, source_tags_json, category FROM prompt_index");
  const update = database.query("UPDATE prompt_index SET tags_json = ?, media = ?, requires_reference = ?, search_text = ? WHERE source_id = ? AND prompt_id = ?");
  let updated = 0;
  database.transaction(() => {
    for (const row of rows.iterate()) {
      const storedTags = parseStoredTags(row.tags_json);
      const sourceTags = parseStoredTags(row.source_tags_json);
      // The old index stored its single inferred theme in place of the source tags.
      const previousTheme = !sourceTags.length && storedTags.length === 1 && isPromptTaxonomyTag(storedTags[0]) ? storedTags[0] : undefined;
      const rawTags = sourceTags.length ? sourceTags : previousTheme ? [] : storedTags;
      const tags = classifyPromptTags({ title: row.title, prompt: row.prompt, tags: rawTags, previousTheme });
      const tagsJson = JSON.stringify(tags);
      if (tagsJson === JSON.stringify(storedTags)) continue;
      const usage = getPromptUsage({ ...row, tags: [...rawTags, ...tags] });
      update.run(tagsJson, usage.media, Number(usage.requiresReference), getPromptSearchText({ ...row, tags, sourceTags }), row.source_id, row.prompt_id);
      updated += 1;
    }
  })();
  return updated;
}

export function normalizePromptSourceIndexItems(
  source: { id: string; name: string; githubUrl: string },
  input: unknown,
) {
  if (!Array.isArray(input)) throw new Error("提示词索引必须是数组");
  if (input.length === 0) throw new Error("来源没有返回提示词");
  if (input.length > MAX_INDEX_ITEMS_PER_SOURCE) throw new Error("来源返回的提示词超过索引上限");
  const withSource = input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("来源返回了无法识别的提示词条目");
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string" || !record.title.trim() || typeof record.prompt !== "string" || !record.prompt.trim() || record.prompt.trim().length > MAX_PROMPT_TEXT || (record.id && !String(record.id).trim())) {
      throw new Error("来源返回的提示词缺少标题、正文或正文超过长度上限");
    }
    return {
      ...record,
      category: source.name,
      githubUrl: source.githubUrl,
    };
  });
  return normalizePromptIndexItems(source.id, withSource);
}

export function backfillPromptIndexMetadata(database: Database) {
  const rows = database.query<StoredPromptTaxonomyRow, []>("SELECT source_id, prompt_id, title, prompt, tags_json, source_tags_json, category FROM prompt_index");
  const update = database.query("UPDATE prompt_index SET source_tags_json = ?, media = ?, requires_reference = ?, search_title = ?, search_text = ? WHERE source_id = ? AND prompt_id = ?");
  for (const row of rows.iterate()) {
    const tags = parseStoredTags(row.tags_json);
    const sourceTags = tags.length === 1 && isPromptTaxonomyTag(tags[0]) ? [] : tags;
    const usage = getPromptUsage({ title: row.title, prompt: row.prompt, tags: [...sourceTags, ...tags] });
    update.run(JSON.stringify(sourceTags), usage.media, Number(usage.requiresReference), row.title.trim().toLowerCase(), getPromptSearchText({ ...row, tags, sourceTags }), row.source_id, row.prompt_id);
  }
}

export function replacePromptIndex(database: Database, sourceId: string, items: PromptIndexItem[]) {
  const timestamp = Date.now();
  database.transaction(() => {
    database.query("DELETE FROM prompt_index WHERE source_id = ?").run(sourceId);
    const insert = database.query(
      "INSERT INTO prompt_index(source_id, prompt_id, title, prompt, cover_url, preview, tags_json, category, github_url, created_at, updated_at, indexed_at, source_tags_json, media, requires_reference, search_title, search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const item of items) {
      const sourceTags = item.sourceTags ?? [];
      const usage = item.usage ?? getPromptUsage({ ...item, tags: [...sourceTags, ...item.tags] });
      insert.run(sourceId, item.id, item.title, item.prompt, item.coverUrl, item.preview, JSON.stringify(item.tags), item.category, item.githubUrl, item.createdAt, item.updatedAt, timestamp, JSON.stringify(sourceTags), usage.media, Number(usage.requiresReference), item.title.trim().toLowerCase(), getPromptSearchText({ ...item, sourceTags }));
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
  const terms = tokenizePromptKeyword(options.keyword || "");
  const sourceId = String(options.sourceId || "").trim();
  const category = String(options.category || "").trim();
  const tags = Array.isArray(options.tags) ? options.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 20) : [];
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
  const scope = ["1 = 1"];
  const scopeParams: string[] = [];
  const enabledIds = options.enabledSourceIds === undefined ? null : JSON.stringify(options.enabledSourceIds);
  if (enabledIds !== null) {
    scope.push("source_id IN (SELECT value FROM json_each(?))");
    scopeParams.push(enabledIds);
  }
  if (sourceId) {
    scope.push("source_id = ?");
    scopeParams.push(sourceId);
  }
  if (options.media) {
    scope.push("media IN (?, 'general')");
    scopeParams.push(options.media);
  }

  const provenanceScope = [...scope];
  const provenanceParams = [...scopeParams];
  if (category && category !== "全部" && category !== "all") {
    provenanceScope.push("category = ?");
    provenanceParams.push(category);
  }

  const matchWhere: string[] = [];
  const matchParams: string[] = [];
  const searchTerms = JSON.stringify(terms);
  if (terms.length) {
    matchWhere.push("NOT EXISTS (SELECT 1 FROM json_each(?) WHERE instr(COALESCE(search_text, lower(title || ' ' || prompt || ' ' || category || ' ' || tags_json)), value) = 0)");
    matchParams.push(searchTerms);
  }
  const facetsWhere = [...provenanceScope, ...matchWhere];
  const facetsParams = [...provenanceParams, ...matchParams];
  if (tags.length) {
    matchWhere.push("EXISTS (SELECT 1 FROM json_each(scoped.tags_json) WHERE value IN (SELECT value FROM json_each(?)))");
    matchParams.push(JSON.stringify(tags));
  }

  const relevance = terms.length > 0 && (!options.order || options.order === "relevance");
  const searchTitle = "COALESCE(search_title, lower(trim(title)))";
  const titleRank = relevance
    ? `CASE WHEN ${searchTitle} = ? THEN 3 WHEN instr(${searchTitle}, ?) = 1 THEN 2 WHEN NOT EXISTS (SELECT 1 FROM json_each(?) WHERE instr(${searchTitle}, value) = 0) THEN 1 ELSE 0 END`
    : "0";
  const phrase = terms.join(" ");
  const rankParams = relevance ? [phrase, phrase, searchTerms] : [];
  const direction = options.order === "asc" ? "ASC" : "DESC";
  const orderBy = `match_rank DESC, indexed_at ${direction}, item_rowid ${direction}`;

  // Search selects the representative; all matching bodies in scope can supply origins.
  const rows = database.query(`
    WITH scoped AS NOT MATERIALIZED (
      SELECT rowid AS item_rowid, * FROM prompt_index WHERE ${provenanceScope.join(" AND ")}
    ),
    filtered AS MATERIALIZED (
      SELECT item_rowid, prompt, indexed_at, ${titleRank} AS match_rank
      FROM scoped WHERE ${matchWhere.join(" AND ") || "1 = 1"}
    ),
    duplicates AS (
      SELECT prompt, MIN(item_rowid) AS group_id FROM scoped
      ${matchWhere.length ? "WHERE prompt IN (SELECT prompt FROM filtered)" : ""}
      GROUP BY prompt HAVING MIN(source_id) <> MAX(source_id)
    ),
    origins AS MATERIALIZED (
      SELECT scoped.item_rowid, scoped.indexed_at, source_id, title, category, github_url, media, requires_reference,
        duplicates.group_id, filtered.match_rank
      FROM scoped JOIN duplicates USING (prompt) LEFT JOIN filtered USING (item_rowid)
    ),
    ranked AS (
      SELECT item_rowid, group_id, match_rank, indexed_at,
        ROW_NUMBER() OVER (PARTITION BY COALESCE(group_id, item_rowid) ORDER BY ${orderBy}) AS member_rank
      FROM filtered LEFT JOIN duplicates USING (prompt)
    ),
    page_rows AS (
      SELECT * FROM ranked WHERE member_rank = 1 ORDER BY ${orderBy} LIMIT ? OFFSET ?
    )
    SELECT prompt_index.*, counts.total,
      CASE WHEN page_rows.group_id IS NOT NULL THEN (
        SELECT json_group_array(json_object(
          'sourceId', source_id, 'title', title, 'category', category, 'githubUrl', github_url,
          'media', media, 'requiresReference', requires_reference
        ))
        FROM (
          SELECT * FROM origins WHERE group_id = page_rows.group_id
          ORDER BY ${orderBy}
        )
      ) END AS sources_json
    FROM (SELECT COUNT(*) AS total FROM ranked WHERE member_rank = 1) AS counts
    LEFT JOIN page_rows ON 1 = 1
    LEFT JOIN prompt_index ON prompt_index.rowid = page_rows.item_rowid
    ORDER BY page_rows.match_rank DESC, page_rows.indexed_at ${direction}, page_rows.item_rowid ${direction}
  `).all(...provenanceParams, ...rankParams, ...matchParams, pageSize, (page - 1) * pageSize) as PromptIndexQueryRow[];

  // An intentionally disabled catalog is distinct from an index that has never loaded.
  const indexedScope = enabledIds === null ? "" : " AND source_id IN (SELECT value FROM json_each(?))";
  const indexArgs = enabledIds === null ? [] : [enabledIds, enabledIds];
  const indexState = database.query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM prompt_index WHERE 1 = 1${indexedScope}) OR EXISTS (SELECT 1 FROM prompt_index_status WHERE last_success_at IS NOT NULL${indexedScope}) THEN 1 ELSE 0 END AS indexed`).get(...indexArgs) as { indexed: number };
  const tagRows = database.query(`SELECT DISTINCT json_each.value AS tag FROM prompt_index, json_each(prompt_index.tags_json) WHERE ${facetsWhere.join(" AND ")} ORDER BY tag COLLATE NOCASE`).all(...facetsParams) as Array<{ tag: string }>;
  const categoryRows = database.query(`SELECT DISTINCT category FROM prompt_index WHERE ${scope.join(" AND ")} AND category <> '' ORDER BY category COLLATE NOCASE`).all(...scopeParams) as Array<{ category: string }>;

  return {
    items: rows.flatMap((row) => (row.prompt_id === null ? [] : [promptIndexRow(row)])),
    tags: tagRows.map((row) => row.tag),
    categories: categoryRows.map((row) => row.category),
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
    indexed: options.enabledSourceIds?.length === 0 || indexState.indexed === 1,
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
  source_id: string;
  prompt_id: string;
  title: string;
  prompt: string;
  cover_url: string;
  preview: string;
  tags_json: string;
  source_tags_json: string;
  media: PromptUsage["media"];
  requires_reference: number;
  category: string;
  github_url: string;
  created_at: string;
  updated_at: string;
};

type PromptIndexQueryRow = PromptIndexRow & { total: number; sources_json: string | null };
type StoredPromptOrigin = PromptOrigin & { media: PromptUsage["media"]; requiresReference: number };

type PromptIndexStatusRow = {
  source_id: string;
  count: number;
  last_success_at: number | null;
  last_error: string;
};

type StoredPromptTaxonomyRow = {
  source_id: string;
  prompt_id: string;
  title: string;
  prompt: string;
  tags_json: string;
  source_tags_json: string;
  category: string;
};

function promptIndexRow(row: PromptIndexQueryRow): PromptIndexItem {
  const tags = parseStoredTags(row.tags_json);
  const sourceTags = parseStoredTags(row.source_tags_json);
  const origins = row.sources_json ? JSON.parse(row.sources_json) as StoredPromptOrigin[] : undefined;
  const mergedUsage = origins ? mergePromptUsage(origins.map((origin) => ({ media: origin.media, requiresReference: origin.requiresReference === 1 }))) : undefined;
  const sources = new Map<string, PromptOrigin>();
  for (const { sourceId, title, category, githubUrl } of origins ?? []) {
    const key = sourceId || category;
    if (!sources.has(key)) sources.set(key, { sourceId, title, category, githubUrl });
  }
  return {
    sourceId: row.source_id,
    id: row.prompt_id,
    title: row.title,
    prompt: row.prompt,
    coverUrl: row.cover_url,
    preview: row.preview,
    tags,
    sourceTags,
    sources: origins ? [...sources.values()] : undefined,
    usage: mergedUsage ?? { media: row.media, requiresReference: row.requires_reference === 1 },
    category: row.category,
    githubUrl: row.github_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStoredTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeUrl(value: unknown) {
  const text = String(value || "").trim().slice(0, 2_048);
  return /^(?:https?:\/\/|\/)/i.test(text) ? text : "";
}

function safeDate(value: unknown) {
  const text = String(value || "").trim();
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

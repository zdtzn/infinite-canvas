import type { Database } from "bun:sqlite";

const ASSET_KEY_PATTERN = /^image:[A-Za-z0-9._:-]{1,180}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_DOCUMENTS_PER_USER = 12;
const MAX_DOCUMENT_BYTES = 192 * 1024;
const MAX_HISTORY_ENTRIES = 50;
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export type ColorAlchemySource = {
  key: string;
  title: string;
  storageKey: string;
  width?: number;
  height?: number;
  mimeType?: string;
  origin?: {
    route: string;
    projectId?: string;
    nodeId?: string;
  };
};

export type ColorAlchemyDocument = {
  id: string;
  source: ColorAlchemySource;
  reference?: ColorAlchemySource & { analysis?: Record<string, unknown> };
  settings: Record<string, unknown>;
  history: Record<string, unknown>[];
  historyIndex: number;
  analysis?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type ColorAlchemyDocumentTombstone = {
  id: string;
  deletedAt: number;
};

export type ColorAlchemyDocumentList = {
  items: ColorAlchemyDocument[];
  deleted: ColorAlchemyDocumentTombstone[];
};

export type ColorAlchemySaveResult =
  | { kind: "document"; document: ColorAlchemyDocument }
  | { kind: "deleted"; deleted: ColorAlchemyDocumentTombstone };

export class ColorAlchemyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "COLOR_ALCHEMY_INVALID",
  ) {
    super(message);
    this.name = "ColorAlchemyError";
  }
}

export function createColorAlchemyService(
  database: Database,
  options: { now?: () => number } = {},
) {
  const now = options.now || Date.now;

  function listDocuments(userId: string): ColorAlchemyDocumentList {
    pruneTombstones(userId);
    const items = (
      database
        .query(
          "SELECT * FROM color_alchemy_documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
        )
        .all(userId, MAX_DOCUMENTS_PER_USER) as ColorAlchemyDocumentRow[]
    )
      .map(documentFromRow)
      .filter((document): document is ColorAlchemyDocument => Boolean(document));
    const deleted = database
      .query(
        "SELECT document_id, deleted_at FROM color_alchemy_document_tombstones WHERE user_id = ? ORDER BY deleted_at DESC",
      )
      .all(userId)
      .map((row) => ({
        id: String((row as ColorAlchemyDocumentTombstoneRow).document_id),
        deletedAt: Number((row as ColorAlchemyDocumentTombstoneRow).deleted_at),
      }));
    return { items, deleted };
  }

  function saveDocument(userId: string, documentId: string, input: unknown): ColorAlchemySaveResult {
    const id = validDocumentId(documentId);
    const tombstone = database
      .query(
        "SELECT document_id, deleted_at FROM color_alchemy_document_tombstones WHERE user_id = ? AND document_id = ?",
      )
      .get(userId, id) as ColorAlchemyDocumentTombstoneRow | null;
    if (tombstone) {
      return {
        kind: "deleted",
        deleted: { id: tombstone.document_id, deletedAt: Number(tombstone.deleted_at) },
      };
    }
    const payload = normalizePayload(database, userId, input);
    const incomingUpdatedAt = inputTimestamp(input, now());
    const existing = database
      .query(
        "SELECT payload_json, created_at, updated_at FROM color_alchemy_documents WHERE user_id = ? AND document_id = ?",
      )
      .get(userId, id) as ColorAlchemyDocumentRow | null;
    if (existing && incomingUpdatedAt < Number(existing.updated_at)) {
      const current = documentFromRow(existing);
      if (current) return { kind: "document", document: current };
    }
    if (!existing) {
      const count = Number(
        (
          database
            .query(
              "SELECT COUNT(*) AS count FROM color_alchemy_documents WHERE user_id = ?",
            )
            .get(userId) as { count: number }
        ).count,
      );
      if (count >= MAX_DOCUMENTS_PER_USER) {
        const oldest = database
          .query(
            "SELECT document_id FROM color_alchemy_documents WHERE user_id = ? ORDER BY updated_at ASC, rowid ASC LIMIT 1",
          )
          .get(userId) as { document_id: string } | null;
        database
          .query(
            "DELETE FROM color_alchemy_documents WHERE user_id = ? AND document_id = ?",
          )
          .run(userId, oldest?.document_id || "");
        if (oldest)
          database
            .query(
              `INSERT INTO color_alchemy_document_tombstones(user_id, document_id, deleted_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id, document_id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
            )
            .run(userId, oldest.document_id, now());
      }
    }

    const timestamp = now();
    const createdAt = existing ? Number(existing.created_at) : timestamp;
    // The browser assigns the draft revision before the request begins. Persisting
    // that value prevents a slow earlier request from eclipsing a later edit.
    const updatedAt = incomingUpdatedAt;
    const payloadJson = JSON.stringify(payload);
    database
      .query(
        `INSERT INTO color_alchemy_documents(user_id, document_id, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, document_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      )
      .run(userId, id, payloadJson, createdAt, updatedAt);
    return { kind: "document", document: documentFromPayload(id, payload, createdAt, updatedAt) };
  }

  function deleteDocument(userId: string, documentId: string) {
    const id = validDocumentId(documentId);
    database
      .query(
        "DELETE FROM color_alchemy_documents WHERE user_id = ? AND document_id = ?",
      )
      .run(userId, id);
    const deletedAt = now();
    database
      .query(
        `INSERT INTO color_alchemy_document_tombstones(user_id, document_id, deleted_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, document_id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
      )
      .run(userId, id, deletedAt);
    pruneTombstones(userId);
    return { id, deletedAt };
  }

  function assetReferenceRoots(userId: string) {
    const rows = database
      .query(
        "SELECT payload_json FROM color_alchemy_documents WHERE user_id = ?",
      )
      .all(userId) as Array<{ payload_json: string }>;
    return rows.flatMap((row) => {
      const document = parsePayload(row.payload_json);
      if (!document) return [];
      return [
        { storageKey: document.source.storageKey },
        ...(document.reference ? [{ storageKey: document.reference.storageKey }] : []),
      ];
    });
  }

  function pruneTombstones(userId: string) {
    database
      .query(
        "DELETE FROM color_alchemy_document_tombstones WHERE user_id = ? AND deleted_at < ?",
      )
      .run(userId, now() - TOMBSTONE_RETENTION_MS);
  }

  return {
    listDocuments,
    saveDocument,
    deleteDocument,
    assetReferenceRoots,
  };
}

type ColorAlchemyDocumentRow = {
  document_id: string;
  payload_json: string;
  created_at: number;
  updated_at: number;
};

type ColorAlchemyDocumentTombstoneRow = {
  document_id: string;
  deleted_at: number;
};

type ColorAlchemyDocumentPayload = Omit<
  ColorAlchemyDocument,
  "id" | "createdAt" | "updatedAt"
>;

function documentFromRow(row: ColorAlchemyDocumentRow) {
  const payload = parsePayload(row.payload_json);
  return payload
    ? documentFromPayload(
        row.document_id,
        payload,
        Number(row.created_at),
        Number(row.updated_at),
      )
    : null;
}

function documentFromPayload(
  id: string,
  payload: ColorAlchemyDocumentPayload,
  createdAt: number,
  updatedAt: number,
): ColorAlchemyDocument {
  return { id, ...payload, createdAt, updatedAt };
}

function normalizePayload(
  database: Database,
  userId: string,
  input: unknown,
): ColorAlchemyDocumentPayload {
  const source = inputRecord(input, "灵彩草稿内容无效");
  const settings = jsonRecord(source.settings, 24 * 1024, "调色参数无效");
  const history = jsonRecordArray(
    source.history,
    MAX_HISTORY_ENTRIES,
    128 * 1024,
    "调色历史无效",
  );
  if (!history.length) throw new ColorAlchemyError("调色历史不能为空");
  const historyIndex = boundedInteger(source.historyIndex, 0, history.length - 1);
  const payload: ColorAlchemyDocumentPayload = {
    source: normalizeSource(database, userId, source.source, "原图"),
    ...(source.reference === undefined
      ? {}
      : {
          reference: {
            ...normalizeSource(database, userId, source.reference, "参考图"),
            ...(source.reference && typeof source.reference === "object"
              ? {
                  analysis: optionalJsonRecord(
                    (source.reference as Record<string, unknown>).analysis,
                    24 * 1024,
                    "参考图分析无效",
                  ),
                }
              : {}),
          },
        }),
    settings,
    history,
    historyIndex,
    ...(source.analysis === undefined
      ? {}
      : {
          analysis: optionalJsonRecord(
            source.analysis,
            24 * 1024,
            "色彩分析无效",
          ),
        }),
  };
  assertJsonSize(payload, MAX_DOCUMENT_BYTES, "灵彩草稿过大");
  return payload;
}

function normalizeSource(
  database: Database,
  userId: string,
  value: unknown,
  label: string,
): ColorAlchemySource {
  const source = inputRecord(value, `${label}信息无效`);
  const asset = ownedImageAsset(database, userId, source.storageKey, label);
  const origin = normalizeOrigin(source.origin);
  return {
    key: optionalText(source.key, 240) || asset.key,
    title: optionalText(source.title, 180) || "未命名图片",
    storageKey: asset.key,
    ...(boundedOptionalInteger(source.width, 1, 50_000) !== undefined
      ? { width: boundedOptionalInteger(source.width, 1, 50_000) }
      : {}),
    ...(boundedOptionalInteger(source.height, 1, 50_000) !== undefined
      ? { height: boundedOptionalInteger(source.height, 1, 50_000) }
      : {}),
    mimeType: asset.mimeType,
    ...(origin ? { origin } : {}),
  };
}

function normalizeOrigin(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const route = optionalText(source.route, 200);
  if (!route || !route.startsWith("/canvas/")) return undefined;
  const projectId = optionalText(source.projectId, 120);
  const nodeId = optionalText(source.nodeId, 120);
  return {
    route,
    ...(projectId ? { projectId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

function ownedImageAsset(
  database: Database,
  userId: string,
  value: unknown,
  label: string,
) {
  const assetKey = String(value || "").trim();
  if (!ASSET_KEY_PATTERN.test(assetKey))
    throw new ColorAlchemyError(`${label}素材标识无效`);
  const asset = database
    .query(
      "SELECT asset_key, mime_type FROM assets WHERE user_id = ? AND asset_key = ?",
    )
    .get(userId, assetKey) as { asset_key: string; mime_type: string } | null;
  if (!asset || !asset.mime_type.startsWith("image/"))
    throw new ColorAlchemyError(
      `${label}素材不存在或不属于当前账号`,
      400,
      "ASSET_NOT_OWNED",
    );
  return { key: asset.asset_key, mimeType: asset.mime_type };
}

function parsePayload(value: string): ColorAlchemyDocumentPayload | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const source = parsed as Partial<ColorAlchemyDocumentPayload>;
    if (!source.source || !source.settings || !Array.isArray(source.history)) return null;
    return source as ColorAlchemyDocumentPayload;
  } catch {
    return null;
  }
}

function inputRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ColorAlchemyError(message);
  return value as Record<string, unknown>;
}

function jsonRecord(value: unknown, maxBytes: number, message: string) {
  const record = inputRecord(value, message);
  assertJsonSize(record, maxBytes, message);
  return record;
}

function optionalJsonRecord(value: unknown, maxBytes: number, message: string) {
  if (value === undefined) return undefined;
  return jsonRecord(value, maxBytes, message);
}

function jsonRecordArray(
  value: unknown,
  maxLength: number,
  maxBytes: number,
  message: string,
) {
  if (!Array.isArray(value) || value.length > maxLength)
    throw new ColorAlchemyError(message);
  const records = value.map((item) => inputRecord(item, message));
  assertJsonSize(records, maxBytes, message);
  return records;
}

function assertJsonSize(value: unknown, maxBytes: number, message: string) {
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ColorAlchemyError(message);
  }
  if (!serialized || Buffer.byteLength(serialized) > maxBytes)
    throw new ColorAlchemyError(message);
}

function validDocumentId(value: unknown) {
  const id = String(value || "").trim();
  if (!DOCUMENT_ID_PATTERN.test(id))
    throw new ColorAlchemyError("灵彩草稿 ID 无效");
  return id;
}

function inputTimestamp(input: unknown, fallback: number) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const value = (input as Record<string, unknown>).updatedAt;
  const timestamp = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.min(timestamp, fallback + 5 * 60_000)
    : fallback;
}

function optionalText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))
    throw new ColorAlchemyError("灵彩草稿包含无效文本");
  return text;
}

function boundedInteger(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function boundedOptionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new ColorAlchemyError("图片尺寸无效");
  return number;
}

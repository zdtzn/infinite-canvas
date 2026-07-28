import type {
  GenerationHistoryKind,
  StoredAsset,
  StoredGenerationHistoryItem,
} from "../types";

export type { GenerationHistoryKind, StoredGenerationHistoryItem };

const HISTORY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,180}$/;
const MAX_HISTORY_ITEMS = 5_000;
const MAX_HISTORY_JSON = 512_000;
const MAX_HISTORY_DEPTH = 12;
const SENSITIVE_KEYS = new Set([
  "apiKey",
  "accessCode",
  "personalCode",
  "authorization",
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
]);

export class GenerationHistoryInputError extends Error {}

export function normalizeGenerationHistoryDeletion(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new GenerationHistoryInputError("删除生成记录的请求格式无效");
  const source = input as Record<string, unknown>;
  const ids = normalizeDeletionIds(source.ids, "生成记录");
  if (!ids.length)
    throw new GenerationHistoryInputError("请选择要删除的生成记录");
  return {
    ids,
    jobIds: normalizeDeletionIds(source.jobIds ?? [], "生成任务"),
  };
}

export function generationHistoryJobIdsForDeletion(
  kind: GenerationHistoryKind,
  ids: string[],
  records: StoredGenerationHistoryItem[],
) {
  const selectedIds = new Set(ids);
  const remainingJobIds = new Set(
    records
      .filter((item) => item.kind !== kind || !selectedIds.has(item.id))
      .flatMap(historyJobIds),
  );
  return Array.from(
    new Set(
      records
        .filter((item) => item.kind === kind && selectedIds.has(item.id))
        .flatMap(historyJobIds),
    ),
  ).filter((id) => !remainingJobIds.has(id));
}

export function normalizeGenerationHistory(
  kind: GenerationHistoryKind,
  input: unknown,
  ownedAsset: (storageKey: string) => StoredAsset | undefined,
) {
  if (!Array.isArray(input))
    throw new GenerationHistoryInputError("生成记录格式无效");
  if (input.length > MAX_HISTORY_ITEMS)
    throw new GenerationHistoryInputError(
      `生成记录最多保存 ${MAX_HISTORY_ITEMS} 条`,
    );
  return input.map((item) =>
    normalizeGenerationHistoryItem(kind, item, undefined, ownedAsset),
  );
}

export function normalizeGenerationHistoryItem(
  kind: GenerationHistoryKind,
  input: unknown,
  expectedId: string | undefined,
  ownedAsset: (storageKey: string) => StoredAsset | undefined,
): StoredGenerationHistoryItem {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new GenerationHistoryInputError("生成记录格式无效");
  const source = input as Record<string, unknown>;
  const id = String(expectedId || source.id || "").trim();
  if (!HISTORY_ID_PATTERN.test(id))
    throw new GenerationHistoryInputError("生成记录标识无效");
  if (expectedId && source.id && source.id !== expectedId)
    throw new GenerationHistoryInputError("生成记录标识不一致");

  const createdAt = normalizeTimestamp(source.createdAt, Date.now());
  const updatedAt = normalizeTimestamp(source.updatedAt, createdAt);
  const payload = sanitizeHistoryValue(source, ownedAsset, 0) as Record<
    string,
    unknown
  >;
  delete payload.ownerUserId;
  payload.id = id;
  payload.createdAt = createdAt;
  payload.updatedAt = updatedAt;
  const json = JSON.stringify(payload);
  if (json.length > MAX_HISTORY_JSON)
    throw new GenerationHistoryInputError("单条生成记录过大");

  return { id, kind, payload, createdAt, updatedAt };
}

function sanitizeHistoryValue(
  input: unknown,
  ownedAsset: (storageKey: string) => StoredAsset | undefined,
  depth: number,
): unknown {
  if (depth > MAX_HISTORY_DEPTH)
    throw new GenerationHistoryInputError("生成记录嵌套过深");
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  if (typeof input === "string") return input.slice(0, 200_000);
  if (Array.isArray(input))
    return input
      .slice(0, 5_000)
      .map((item) => sanitizeHistoryValue(item, ownedAsset, depth + 1));
  if (!input || typeof input !== "object") return undefined;

  const source = input as Record<string, unknown>;
  const storageKey = String(source.storageKey || "").trim();
  const stored = storageKey ? ownedAsset(storageKey) : undefined;
  if (storageKey && !stored)
    throw new GenerationHistoryInputError(
      "生成记录引用的素材不存在或不属于当前用户",
    );

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "ownerUserId" || SENSITIVE_KEYS.has(key)) continue;
    if (storageKey && (key === "dataUrl" || key === "url")) {
      result[key] = "";
      continue;
    }
    const sanitized = sanitizeHistoryValue(value, ownedAsset, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  if (storageKey && stored) {
    result.storageKey = storageKey;
    result.bytes = stored.bytes;
    result.mimeType = stored.mimeType;
  }
  return result;
}

function normalizeTimestamp(input: unknown, fallback: number) {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeDeletionIds(input: unknown, label: string) {
  if (!Array.isArray(input))
    throw new GenerationHistoryInputError(`${label}列表格式无效`);
  if (input.length > MAX_HISTORY_ITEMS)
    throw new GenerationHistoryInputError(
      `单次最多删除 ${MAX_HISTORY_ITEMS} 条${label}`,
    );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    const id = String(value || "").trim();
    if (!HISTORY_ID_PATTERN.test(id))
      throw new GenerationHistoryInputError(`${label}标识无效`);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function historyJobIds(item: StoredGenerationHistoryItem) {
  if (!Array.isArray(item.payload.serverJobIds)) return [];
  return item.payload.serverJobIds
    .map((value) => String(value || "").trim())
    .filter((id) => HISTORY_ID_PATTERN.test(id));
}

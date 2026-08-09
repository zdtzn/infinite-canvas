import type { StoredAsset, StoredLibraryAsset } from "../types";

const MAX_LIBRARY_ITEMS = 5_000;
const MAX_TEXT_CONTENT = 200_000;
const MAX_METADATA_JSON = 32_000;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class AssetLibraryInputError extends Error {}

export function normalizeAssetLibrary(
  input: unknown,
  ownedAsset: (storageKey: string) => StoredAsset | undefined,
) {
  if (!Array.isArray(input))
    throw new AssetLibraryInputError("资产目录格式无效");
  if (input.length > MAX_LIBRARY_ITEMS)
    throw new AssetLibraryInputError(`资产目录最多保存 ${MAX_LIBRARY_ITEMS} 项`);
  return input.map((item) => normalizeAssetLibraryItem(item, undefined, ownedAsset));
}

export function normalizeAssetLibraryItem(
  input: unknown,
  expectedId: string | undefined,
  ownedAsset: (storageKey: string) => StoredAsset | undefined,
): StoredLibraryAsset {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AssetLibraryInputError("资产记录格式无效");
  const source = input as Record<string, unknown>;
  const id = String(expectedId || source.id || "").trim();
  if (!ASSET_ID_PATTERN.test(id))
    throw new AssetLibraryInputError("资产记录标识无效");
  if (expectedId && source.id && source.id !== expectedId)
    throw new AssetLibraryInputError("资产记录标识不一致");

  const kind = String(source.kind || "");
  if (!["text", "image", "video"].includes(kind))
    throw new AssetLibraryInputError("不支持的资产类型");
  const now = new Date().toISOString();
  const createdAt = normalizeDate(source.createdAt, now);
  const updatedAt = normalizeDate(source.updatedAt, now);
  const payload: Record<string, unknown> = {
    id,
    kind,
    title: String(source.title || "未命名资产").trim().slice(0, 200) || "未命名资产",
    coverUrl: kind === "text" ? normalizeCoverUrl(source.coverUrl) : "",
    tags: normalizeTags(source.tags),
    createdAt,
    updatedAt,
  };
  const assetSource = optionalString(source.source, 120);
  const note = optionalString(source.note, 2_000);
  if (assetSource) payload.source = assetSource;
  if (note) payload.note = note;
  const metadata = normalizeMetadata(source.metadata);
  if (metadata) payload.metadata = metadata;

  const data = source.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new AssetLibraryInputError("资产内容格式无效");
  const content = data as Record<string, unknown>;
  if (kind === "text") {
    payload.data = {
      content: String(content.content || "").slice(0, MAX_TEXT_CONTENT),
    };
  } else {
    const storageKey = String(content.storageKey || "").trim();
    const stored = storageKey ? ownedAsset(storageKey) : undefined;
    if (!stored)
      throw new AssetLibraryInputError("资产文件不存在或不属于当前用户");
    if (kind === "image" && !stored.mimeType.startsWith("image/"))
      throw new AssetLibraryInputError("资产文件不是图片");
    if (kind === "video" && !stored.mimeType.startsWith("video/"))
      throw new AssetLibraryInputError("资产文件不是视频");
    const thumbnailKey = kind === "image" ? String(content.thumbnailKey || "").trim() : "";
    const thumbnail = thumbnailKey ? ownedAsset(thumbnailKey) : undefined;
    if (thumbnailKey && (!thumbnail || !thumbnail.mimeType.startsWith("image/")))
      throw new AssetLibraryInputError("资产缩略图不存在或不属于当前用户");
    const media = {
      storageKey,
      width: positiveNumber(content.width),
      height: positiveNumber(content.height),
      bytes: stored.bytes,
      mimeType: stored.mimeType,
    };
    payload.data = kind === "image" ? { ...media, ...(thumbnailKey ? { thumbnailKey } : {}), dataUrl: "" } : { ...media, url: "" };
  }

  return {
    id,
    payload,
    updatedAt: Date.parse(updatedAt) || Date.now(),
  };
}

function normalizeTags(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .slice(0, 30)
        .map((tag) => String(tag || "").trim().slice(0, 50))
        .filter(Boolean),
    ),
  );
}

function normalizeCoverUrl(input: unknown) {
  const value = String(input || "").trim().slice(0, 2_048);
  if (!value || /^(?:javascript|vbscript):/i.test(value) || value.startsWith("data:"))
    return "";
  return value;
}

function normalizeMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const json = JSON.stringify(input);
  if (json.length > MAX_METADATA_JSON)
    throw new AssetLibraryInputError("资产扩展信息过大");
  return JSON.parse(json) as Record<string, unknown>;
}

function optionalString(input: unknown, maxLength: number) {
  return String(input || "").trim().slice(0, maxLength);
}

function normalizeDate(input: unknown, fallback: string) {
  const value = String(input || "");
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function positiveNumber(input: unknown) {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

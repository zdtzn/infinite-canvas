import type { AppDatabase } from "../db/database";
import type { ServerState } from "../types";
import { normalizeChannelModels, resolvePlatformChannel } from "./platform-channels";

export const IMAGE_MODEL_DEFAULT_SETTING_KEY = "app.default-image-model";
export type PlatformImageDefault = { channelId: string; model: string; revision: number };

export function normalizePlatformImageDefaultTarget(value: unknown): Omit<PlatformImageDefault, "revision"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("默认生图模型配置无效");
  const source = value as Record<string, unknown>;
  if (typeof source.channelId !== "string" || typeof source.model !== "string") throw new Error("请选择默认生图模型");
  const channelId = source.channelId.trim();
  const model = source.model.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(channelId) || ["__proto__", "prototype", "constructor"].includes(channelId.toLowerCase())) throw new Error("默认生图渠道无效");
  if (!model || model.length > 200 || /\p{C}/u.test(model)) throw new Error("默认生图模型无效");
  return { channelId, model };
}

function storedImageDefault(database: Pick<AppDatabase, "loadSetting">): PlatformImageDefault | null {
  const value = database.loadSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY);
  try {
    const target = normalizePlatformImageDefaultTarget(value);
    const revision = (value as Record<string, unknown>).revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return null;
    return { ...target, revision };
  } catch {
    return null;
  }
}

export function platformImageDefaultAvailable(state: ServerState, target: Omit<PlatformImageDefault, "revision">) {
  const channel = resolvePlatformChannel(state, target.channelId);
  return Boolean(channel && normalizeChannelModels(channel.models).some((item) => item.name === target.model && item.capability === "image"));
}

export function loadPlatformImageDefault(database: Pick<AppDatabase, "loadSetting">, state: ServerState): PlatformImageDefault | null {
  const selected = storedImageDefault(database);
  return selected && platformImageDefaultAvailable(state, selected) ? selected : null;
}

export function savePlatformImageDefault(database: Pick<AppDatabase, "loadSetting" | "saveSetting">, target: Omit<PlatformImageDefault, "revision">): PlatformImageDefault {
  const previous = storedImageDefault(database);
  if (previous?.channelId === target.channelId && previous.model === target.model) return previous;
  const revision = (previous?.revision || 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new RangeError("默认生图模型暂时无法更新，请联系管理员");
  const selected = { ...target, revision };
  database.saveSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY, selected);
  return selected;
}

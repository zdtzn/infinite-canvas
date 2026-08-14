import { chatPresets, defaultChatPresetId, type ChatPresetId } from "./chat-presets";

export const USER_SYSTEM_PROMPT_KEY = "system-prompt";
export const USER_CHAT_PRESET_KEY = "chat-preset-id";
export const USER_CHAT_PERSONA_KEY = "chat-persona";
export const MAX_USER_SYSTEM_PROMPT_CHARS = 20_000;
export const MAX_USER_CHAT_PERSONA_CHARS = 2_000;

const chatPresetIds = new Set(chatPresets.map((preset) => preset.id));

export function normalizeUserSystemPrompt(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("系统提示词必须是文本");
  if (value.length > MAX_USER_SYSTEM_PROMPT_CHARS) throw new Error(`系统提示词不能超过 ${MAX_USER_SYSTEM_PROMPT_CHARS} 个字符`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error("系统提示词包含无效控制字符");
  return value;
}

export function readStoredUserSystemPrompt(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function normalizeUserChatPresetId(value: unknown): ChatPresetId {
  if (typeof value !== "string") throw new Error("问道角色预设无效");
  const id = value.trim() as ChatPresetId;
  if (!chatPresetIds.has(id)) throw new Error("问道角色预设不存在");
  return id;
}

export function readStoredUserChatPresetId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim() as ChatPresetId;
  return chatPresetIds.has(id) ? id : null;
}

export function normalizeUserChatPersona(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("用户身份必须是文本");
  if (value.length > MAX_USER_CHAT_PERSONA_CHARS) throw new Error(`用户身份不能超过 ${MAX_USER_CHAT_PERSONA_CHARS} 个字符`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error("用户身份包含无效控制字符");
  return value.trim();
}

export function readStoredUserChatPersona(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return normalizeUserChatPersona(value);
  } catch {
    return null;
  }
}

export function defaultUserChatPresetId() {
  return defaultChatPresetId;
}

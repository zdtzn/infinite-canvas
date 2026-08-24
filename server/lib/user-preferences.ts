import {
  chatPresets,
  defaultChatPresetId,
  type ChatPresetId,
} from "./chat-presets";

export const USER_SYSTEM_PROMPT_KEY = "system-prompt";
export const USER_CHAT_PRESET_KEY = "chat-preset-id";
export const USER_CHAT_PERSONA_KEY = "chat-persona";
export const USER_CANVAS_IMAGE_TOOLBAR_KEY = "canvas-image-toolbar";
export const USER_GENERATION_PREFERENCES_KEY = "generation-preferences";
export const MAX_USER_SYSTEM_PROMPT_CHARS = 20_000;
export const MAX_USER_CHAT_PERSONA_CHARS = 2_000;

const chatPresetIds = new Set(chatPresets.map((preset) => preset.id));
const canvasImageToolbarToolIds = [
  "info",
  "delete",
  "saveAsset",
  "download",
  "edit",
  "copyPrompt",
  "reversePrompt",
  "replace",
  "resize",
  "maskEdit",
  "crop",
  "split",
  "upscale",
  "angle",
  "view",
] as const;
const canvasImageToolbarToolIdSet = new Set<string>(canvasImageToolbarToolIds);

export type UserCanvasImageToolbarPreference = {
  ids: string[];
  showLabels: boolean;
};

export type UserGenerationPreferences = {
  imageModel: string;
  videoModel: string;
  audioModel: string;
  audioVoice: string;
  audioFormat: string;
  audioSpeed: string;
  audioInstructions: string;
  videoSeconds: string;
  vquality: string;
  videoGenerateAudio: string;
  videoWatermark: string;
  quality: string;
  imageQuality: string;
  imageOutputFormat: string;
  size: string;
  background: string;
  count: string;
  canvasImageCount: string;
  snapDimensionToStep: boolean;
};

export function normalizeUserSystemPrompt(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("系统提示词必须是文本");
  if (value.length > MAX_USER_SYSTEM_PROMPT_CHARS)
    throw new Error(
      `系统提示词不能超过 ${MAX_USER_SYSTEM_PROMPT_CHARS} 个字符`,
    );
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
    throw new Error("系统提示词包含无效控制字符");
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
  if (value.length > MAX_USER_CHAT_PERSONA_CHARS)
    throw new Error(`用户身份不能超过 ${MAX_USER_CHAT_PERSONA_CHARS} 个字符`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
    throw new Error("用户身份包含无效控制字符");
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

export function normalizeUserCanvasImageToolbar(
  value: unknown,
): UserCanvasImageToolbarPreference {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("画布图片工具栏偏好无效");
  const source = value as { ids?: unknown; showLabels?: unknown };
  if (!Array.isArray(source.ids) || typeof source.showLabels !== "boolean")
    throw new Error("画布图片工具栏偏好无效");
  const ids = source.ids;
  if (ids.length > canvasImageToolbarToolIds.length)
    throw new Error("画布图片工具栏项目过多");
  if (
    ids.some(
      (id) => typeof id !== "string" || !canvasImageToolbarToolIdSet.has(id),
    )
  )
    throw new Error("画布图片工具栏包含未知工具");
  return {
    ids: canvasImageToolbarToolIds.filter((id) => ids.includes(id)),
    showLabels: source.showLabels,
  };
}

export function readStoredUserCanvasImageToolbar(value: unknown) {
  try {
    return normalizeUserCanvasImageToolbar(value);
  } catch {
    return null;
  }
}

export function normalizeUserGenerationPreferences(
  value: unknown,
): UserGenerationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("生成偏好无效");
  const source = value as Record<string, unknown>;
  return {
    imageModel: boundedPreferenceString(source.imageModel, "默认生图模型", 300),
    videoModel: boundedPreferenceString(source.videoModel, "默认视频模型", 300),
    audioModel: boundedPreferenceString(source.audioModel, "默认音频模型", 300),
    audioVoice: boundedPreferenceString(source.audioVoice, "默认音色", 80),
    audioFormat: boundedPreferenceString(
      source.audioFormat,
      "默认音频格式",
      32,
    ),
    audioSpeed: boundedPreferenceString(source.audioSpeed, "默认音频语速", 16),
    audioInstructions: boundedPreferenceString(
      source.audioInstructions,
      "默认音频指令",
      2_000,
      true,
    ),
    videoSeconds: boundedPreferenceString(
      source.videoSeconds,
      "默认视频时长",
      16,
    ),
    vquality: boundedPreferenceString(source.vquality, "默认视频清晰度", 32),
    videoGenerateAudio: booleanPreferenceString(
      source.videoGenerateAudio,
      "视频声音偏好",
    ),
    videoWatermark: booleanPreferenceString(
      source.videoWatermark,
      "视频水印偏好",
    ),
    quality: enumPreferenceString(source.quality, "默认分辨率", [
      "low",
      "medium",
      "high",
    ]),
    imageQuality: enumPreferenceString(source.imageQuality, "默认生成质量", [
      "auto",
      "low",
      "medium",
      "high",
      "standard",
      "hd",
    ]),
    imageOutputFormat: enumPreferenceString(
      source.imageOutputFormat,
      "默认图片格式",
      ["auto", "png", "jpeg", "webp"],
    ),
    size: boundedPreferenceString(source.size, "默认画面尺寸", 32),
    background: enumPreferenceString(source.background, "默认背景", [
      "",
      "transparent",
    ]),
    count: countPreferenceString(source.count, "默认生成张数"),
    canvasImageCount: countPreferenceString(
      source.canvasImageCount,
      "画布默认生成张数",
    ),
    snapDimensionToStep: booleanPreference(
      source.snapDimensionToStep,
      "尺寸对齐偏好",
    ),
  };
}

export function readStoredUserGenerationPreferences(value: unknown) {
  try {
    return normalizeUserGenerationPreferences(value);
  } catch {
    return null;
  }
}

export function defaultUserChatPresetId() {
  return defaultChatPresetId;
}

function boundedPreferenceString(
  value: unknown,
  label: string,
  maxLength: number,
  preserveWhitespace = false,
) {
  if (typeof value !== "string") throw new Error(`${label}无效`);
  if (value.length > maxLength) throw new Error(`${label}过长`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
    throw new Error(`${label}包含无效控制字符`);
  return preserveWhitespace ? value : value.trim();
}

function enumPreferenceString(
  value: unknown,
  label: string,
  options: readonly string[],
) {
  const normalized = boundedPreferenceString(value, label, 32);
  if (!options.includes(normalized)) throw new Error(`${label}无效`);
  return normalized;
}

function booleanPreferenceString(value: unknown, label: string) {
  const normalized = boundedPreferenceString(value, label, 8);
  if (normalized !== "true" && normalized !== "false")
    throw new Error(`${label}无效`);
  return normalized;
}

function booleanPreference(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label}无效`);
  return value;
}

function countPreferenceString(value: unknown, label: string) {
  const normalized = boundedPreferenceString(value, label, 4);
  const count = Number(normalized);
  if (!Number.isInteger(count) || count < 1 || count > 15)
    throw new Error(`${label}无效`);
  return String(count);
}

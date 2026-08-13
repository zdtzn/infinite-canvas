export const USER_SYSTEM_PROMPT_KEY = "system-prompt";
export const MAX_USER_SYSTEM_PROMPT_CHARS = 20_000;

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

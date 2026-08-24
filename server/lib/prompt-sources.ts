import type { AppDatabase } from "../db/database";

export const MANAGED_PROMPT_SOURCES_SETTING_KEY = "app.prompt-sources";
export const MAX_MANAGED_PROMPT_SOURCES = 100;
export const MAX_PROMPT_SOURCE_NAME_LENGTH = 160;
export const MAX_PROMPT_SOURCE_URL_LENGTH = 2_000;
export const MAX_PROMPT_SOURCE_SCRIPT_LENGTH = 120_000;

const PROMPT_SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
const RESERVED_PROMPT_SOURCE_IDS = new Set([
  "banana-prompt-quicker",
  "davidwu-gpt-image2-prompts",
  "freestylefly-awesome-gpt-image-2",
  "awesome-gpt-image",
  "awesome-gpt4o-image-prompts",
  "jamez-bondos-awesome-gpt4o-images",
  "youmind-gpt-image-2",
  "youmind-nano-banana-pro",
]);

export type ManagedPromptSource = {
  id: string;
  name: string;
  githubUrl: string;
  enabled: boolean;
  script: string;
};

export function isReservedPromptSourceId(id: string) {
  return RESERVED_PROMPT_SOURCE_IDS.has(id);
}

export function normalizeManagedPromptSource(input: unknown, expectedId?: string): ManagedPromptSource {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("提示词来源配置无效");
  const record = input as Record<string, unknown>;
  const id = String(expectedId || record.id || "").trim();
  if (!PROMPT_SOURCE_ID_PATTERN.test(id) || ["__proto__", "prototype", "constructor"].includes(id.toLowerCase())) throw new Error("提示词来源 ID 无效");
  if (isReservedPromptSourceId(id)) throw new Error("内置提示词来源不能作为自定义来源");
  if (expectedId && record.id !== undefined && String(record.id).trim() !== expectedId) throw new Error("提示词来源 ID 与路径不一致");

  const name = String(record.name || "").trim();
  if (!name || name.length > MAX_PROMPT_SOURCE_NAME_LENGTH || /\p{C}/u.test(name)) throw new Error("提示词来源名称无效");
  const githubUrl = String(record.githubUrl || "").trim();
  if (githubUrl.length > MAX_PROMPT_SOURCE_URL_LENGTH || (githubUrl && !/^https?:\/\//i.test(githubUrl))) throw new Error("提示词来源地址无效");
  const script = String(record.script || "").trim();
  if (script.length > MAX_PROMPT_SOURCE_SCRIPT_LENGTH) throw new Error("提示词来源脚本过长");

  return { id, name, githubUrl, enabled: record.enabled !== false, script };
}

export function parseManagedPromptSources(value: unknown): ManagedPromptSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: ManagedPromptSource[] = [];
  for (const item of value.slice(0, MAX_MANAGED_PROMPT_SOURCES)) {
    try {
      const source = normalizeManagedPromptSource(item);
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      sources.push(source);
    } catch {
      // Ignore malformed persisted entries instead of breaking server startup.
    }
  }
  return sources;
}

export function loadManagedPromptSources(database: Pick<AppDatabase, "loadSetting">) {
  return parseManagedPromptSources(database.loadSetting(MANAGED_PROMPT_SOURCES_SETTING_KEY));
}

export function saveManagedPromptSources(database: Pick<AppDatabase, "saveSetting">, sources: ManagedPromptSource[]) {
  database.saveSetting(MANAGED_PROMPT_SOURCES_SETTING_KEY, sources.slice(0, MAX_MANAGED_PROMPT_SOURCES));
}

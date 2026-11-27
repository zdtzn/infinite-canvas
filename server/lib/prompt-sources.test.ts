import { describe, expect, test } from "bun:test";

import {
  MAX_PROMPT_SOURCE_SCRIPT_LENGTH,
  loadAvailablePromptSources,
  saveBuiltInPromptSourceEnabled,
  saveManagedPromptSources,
  normalizeManagedPromptSource,
  parseManagedPromptSources,
} from "./prompt-sources";

describe("managed prompt sources", () => {
  test("normalizes an administrator source without accepting trusted flags", () => {
    expect(
      normalizeManagedPromptSource({
        id: "my-source",
        name: "  My prompts  ",
        githubUrl: "https://github.com/example/prompts",
        enabled: false,
        trusted: true,
        script: " return []; ",
      }),
    ).toEqual({
      id: "my-source",
      name: "My prompts",
      githubUrl: "https://github.com/example/prompts",
      enabled: false,
      script: "return [];",
    });
  });

  test("rejects reserved ids, invalid urls and oversized scripts", () => {
    expect(() => normalizeManagedPromptSource({ id: "awesome-gpt-image", name: "custom", script: "" })).toThrow();
    expect(() => normalizeManagedPromptSource({ id: "custom", name: "custom", githubUrl: "javascript:alert(1)", script: "" })).toThrow();
    expect(() => normalizeManagedPromptSource({ id: "custom", name: "custom", script: "x".repeat(MAX_PROMPT_SOURCE_SCRIPT_LENGTH + 1) })).toThrow();
  });

  test("drops malformed and duplicate persisted entries", () => {
    expect(
      parseManagedPromptSources([
        { id: "custom", name: "one", script: "return [];" },
        { id: "custom", name: "duplicate", script: "return [];" },
        { id: "bad id", name: "invalid", script: "return [];" },
      ]),
    ).toHaveLength(1);
  });
});


test("persisted built-in visibility remains independent of custom sources", () => {
  const settings = new Map<string, unknown>();
  const database = { loadSetting: (key: string) => settings.get(key), saveSetting: (key: string, value: unknown) => { settings.set(key, value); } };
  const builtInId = "awesome-gpt-image";
  const custom = { id: "custom", name: "Custom", githubUrl: "", enabled: false, script: "" };
  saveManagedPromptSources(database, [custom]);
  expect(loadAvailablePromptSources(database).find(({ id }) => id === builtInId)?.enabled).toBe(true);

  saveBuiltInPromptSourceEnabled(database, builtInId, false);
  expect(loadAvailablePromptSources(database).find(({ id }) => id === builtInId)?.enabled).toBe(false);
  saveBuiltInPromptSourceEnabled(database, builtInId, true);
  const sources = loadAvailablePromptSources(database);
  expect(sources.find(({ id }) => id === builtInId)?.enabled).toBe(true);
  expect(sources.find(({ id }) => id === custom.id)).toEqual(custom);
});

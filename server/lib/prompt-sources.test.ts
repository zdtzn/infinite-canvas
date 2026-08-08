import { describe, expect, test } from "bun:test";

import {
  MAX_PROMPT_SOURCE_SCRIPT_LENGTH,
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

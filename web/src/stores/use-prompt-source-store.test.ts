import { describe, expect, test } from "bun:test";

import { migratePromptSourceState } from "./use-prompt-source-store";

describe("prompt source persistence", () => {
    test("keeps legacy custom sources and schedule values during a version upgrade", () => {
        const migrated = migratePromptSourceState({
            sources: [{ id: "custom", name: "自定义来源", githubUrl: "https://example.com/prompts", enabled: false, script: "return [];" }],
            schedule: { intervalMinutes: 360, lastFetchedAt: "2026-08-24T00:00:00.000Z" },
        });

        expect(migrated.sources.some((source) => source.id === "custom" && source.enabled === false)).toBe(true);
        expect(migrated.schedule).toEqual({ intervalMinutes: 360, lastFetchedAt: "2026-08-24T00:00:00.000Z" });
    });
});

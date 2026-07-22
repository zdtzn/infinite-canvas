import { describe, expect, test } from "bun:test";

import { cultivationGenerationBlockReason, cultivationProgressPercent, quotaText, requiredCultivationCapabilities } from "./utils";

describe("cultivation presentation helpers", () => {
    test("clamps experience progress and treats pending breakthroughs as complete", () => {
        expect(cultivationProgressPercent(25, 100, false)).toBe(25);
        expect(cultivationProgressPercent(250, 100, false)).toBe(100);
        expect(cultivationProgressPercent(5, 100, true)).toBe(100);
    });

    test("formats finite and unlimited quotas", () => {
        expect(quotaText(8, false)).toBe("今日剩余 8 次");
        expect(quotaText(null, true)).toBe("今日不限次数");
    });

    test("derives generation capability requirements for the UI", () => {
        expect(requiredCultivationCapabilities({ model: "gpt-image-1", quality: "high", referenceCount: 2, hasMask: false })).toEqual(["generation.hd", "generation.references", "model.gpt-image"]);
    });

    test("explains capability, quota and concurrency blocks before generation", () => {
        const base = { remainingToday: 3, unlimited: false, maxConcurrency: 2, capabilities: ["model.gpt-image"], requestedCount: 1, requiredCapabilities: ["model.gpt-image"] };
        expect(cultivationGenerationBlockReason({ ...base, requiredCapabilities: ["generation.hd", "model.gpt-image"] })).toBe("当前境界尚未开放高清生成");
        expect(cultivationGenerationBlockReason({ ...base, requestedCount: 4 })).toBe("今日仅剩 3 次，请减少生成数量");
        expect(cultivationGenerationBlockReason({ ...base, remainingToday: 10, requestedCount: 3 })).toBe("当前境界最多同时生成 2 张图片");
        expect(cultivationGenerationBlockReason(base)).toBeNull();
    });
});

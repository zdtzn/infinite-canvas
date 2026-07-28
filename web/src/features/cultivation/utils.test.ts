import { describe, expect, test } from "bun:test";

import { cultivationGenerationBlockReason, cultivationProgressPercent, cultivationRefundNotice, cultivationStageLabel, quotaText, requiredCultivationCapabilities } from "./utils";

describe("cultivation presentation helpers", () => {
    test("clamps experience progress and treats pending breakthroughs as complete", () => {
        expect(cultivationProgressPercent(25, 100, false)).toBe(25);
        expect(cultivationProgressPercent(250, 100, false)).toBe(100);
        expect(cultivationProgressPercent(5, 100, true)).toBe(100);
    });

    test("does not duplicate a realm name when its terminal stage has no star label", () => {
        expect(cultivationStageLabel("斗帝", "斗帝")).toBe("斗帝");
        expect(cultivationStageLabel("斗王", "三星")).toBe("斗王 · 三星");
    });

    test("formats finite and unlimited quotas", () => {
        expect(quotaText(8, false)).toBe("今日剩余 8 次");
        expect(quotaText(null, true)).toBe("今日不限次数");
    });

    test("does not describe quota refunds for unlimited users", () => {
        expect(cultivationRefundNotice(false, "all")).toBe("，本次额度已自动退还");
        expect(cultivationRefundNotice(false, "failed")).toBe("，失败额度已自动退还");
        expect(cultivationRefundNotice(true, "all")).toBe("");
        expect(cultivationRefundNotice(true, "failed")).toBe("");
        expect(cultivationRefundNotice(undefined, "all")).toBe("");
    });

    test("derives generation capability requirements for the UI", () => {
        expect(requiredCultivationCapabilities({ model: "gpt-image-1", quality: "high", referenceCount: 2, hasMask: false })).toEqual(["generation.hd", "generation.references", "model.gpt-image"]);
    });

    test("explains capability and quota blocks without treating image count as job concurrency", () => {
        const base = { remainingToday: 3, unlimited: false, maxConcurrency: 2, capabilities: ["model.gpt-image"], requestedCount: 1, requiredCapabilities: ["model.gpt-image"] };
        expect(cultivationGenerationBlockReason({ ...base, requiredCapabilities: ["generation.hd", "model.gpt-image"] })).toBe("当前境界尚未开放高清生成");
        expect(cultivationGenerationBlockReason({ ...base, requestedCount: 4 })).toBe("今日仅剩 3 次，请减少生成数量");
        expect(cultivationGenerationBlockReason({ ...base, remainingToday: 10, requestedCount: 3 })).toBeNull();
        expect(cultivationGenerationBlockReason(base)).toBeNull();
    });
});

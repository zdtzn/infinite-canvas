import { describe, expect, test } from "bun:test";

import { buildCultivationUserPatch } from "./user-update";

describe("cultivation administrator user patches", () => {
    test("submits only fields changed while the drawer was open", () => {
        const initial = {
            stageId: "stage-1",
            currentXp: 100,
            xpDelta: 0,
            dailyLimitOverride: 20,
            unlimited: false,
            status: "NORMAL",
            internalNote: "",
            publicMessage: "",
            reason: "",
        };

        expect(
            buildCultivationUserPatch(initial, {
                ...initial,
                internalNote: "reviewed",
                reason: "update note",
            }),
        ).toEqual({
            internalNote: "reviewed",
            reason: "update note",
        });
    });

    test("preserves an explicit quota reset and a non-zero XP adjustment", () => {
        const initial = {
            stageId: "stage-1",
            currentXp: 100,
            xpDelta: 0,
            dailyLimitOverride: 20,
            unlimited: false,
            status: "NORMAL",
            internalNote: "",
            publicMessage: "",
            reason: "",
        };

        expect(
            buildCultivationUserPatch(initial, {
                ...initial,
                xpDelta: 5,
                dailyLimitOverride: null,
                reason: "adjust quota and XP",
            }),
        ).toEqual({
            xpDelta: 5,
            dailyLimitOverride: null,
            reason: "adjust quota and XP",
        });
    });

    test("omits an empty optional reason while preserving user changes", () => {
        const initial = {
            stageId: "stage-1",
            currentXp: 100,
            xpDelta: 0,
            dailyLimitOverride: 20,
            unlimited: false,
            status: "NORMAL",
            internalNote: "",
            publicMessage: "",
            reason: "",
        };

        expect(
            buildCultivationUserPatch(initial, {
                ...initial,
                stageId: "stage-2",
                reason: "   ",
            }),
        ).toEqual({
            stageId: "stage-2",
        });
    });
});

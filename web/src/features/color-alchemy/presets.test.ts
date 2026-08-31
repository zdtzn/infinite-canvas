import { describe, expect, test } from "bun:test";

import { QUICK_COLOR_PRESETS } from "./presets";

describe("color alchemy quick presets", () => {
    test("keeps the focused preset set in the intended order", () => {
        expect(QUICK_COLOR_PRESETS.map((preset) => preset.name)).toEqual(["自然", "通透", "高级", "电影", "鲜艳", "电商"]);
    });

    test("keeps the commerce preset conservative about product colors", () => {
        const commerce = QUICK_COLOR_PRESETS.find((preset) => preset.name === "电商");
        expect(commerce).toBeDefined();
        expect(Math.abs(commerce?.settings.saturation || 0)).toBeLessThanOrEqual(4);
        expect(commerce?.settings.temperature || 0).toBe(0);
        expect(commerce?.settings.tint || 0).toBe(0);
        expect(commerce?.settings.hsl).toBeUndefined();
        expect(commerce?.settings.splitTone).toBeUndefined();
    });
});

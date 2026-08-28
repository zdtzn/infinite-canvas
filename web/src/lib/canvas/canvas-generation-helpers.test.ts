import { describe, expect, test } from "bun:test";

import { buildLightingLabel, buildLightingPrompt } from "./canvas-generation-helpers";

describe("canvas lighting prompt", () => {
    test("preserves the source composition while expressing selected lighting parameters", () => {
        const params = { mode: "perspective" as const, direction: "back" as const, lightPosition: { x: 0.62, y: -0.44 }, brightness: 82, temperature: 3200 };
        const prompt = buildLightingPrompt(params);

        expect(buildLightingLabel(params)).toBe("AI 打光：后方逆光，亮度 82%，色温 3200K");
        expect(prompt).toContain("严格保持原图主体身份");
        expect(prompt).toContain("文字内容");
        expect(prompt).toContain("后方逆光");
        expect(prompt).toContain("右上方");
        expect(prompt).toContain("水平偏移 62%");
        expect(prompt).toContain("垂直偏移 -44%");
        expect(prompt).toContain("色温 3200K");
        expect(prompt).toContain("偏暖的金橙色光线");
    });
});

import { expect, test } from "bun:test";

import { formatCanvasGenerationElapsed } from "./canvas-generation-time";

test("formats canvas generation wait time without going negative", () => {
    expect(formatCanvasGenerationElapsed(100_000, 100_000)).toBe("已等待 0秒");
    expect(formatCanvasGenerationElapsed(35_000, 42_000)).toBe("已等待 7秒");
    expect(formatCanvasGenerationElapsed(0, 42_000)).toBe("已等待 0秒");
    expect(formatCanvasGenerationElapsed(10_000, 75_000)).toBe("已等待 1分05秒");
});

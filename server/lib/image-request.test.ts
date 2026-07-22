import { expect, test } from "bun:test";

import { resolveOpenAiImageSize } from "./image-request";

test("converts workbench ratio presets to OpenAI pixel dimensions", () => {
    expect(resolveOpenAiImageSize("1:1")).toBe("1024x1024");
    expect(resolveOpenAiImageSize("16:9")).toBe("1824x1024");
    expect(resolveOpenAiImageSize("9:16")).toBe("1024x1824");
    expect(resolveOpenAiImageSize("1:1", "medium")).toBe("2048x2048");
});

test("preserves explicit pixel dimensions and omits auto sizing", () => {
    expect(resolveOpenAiImageSize("2048x1152")).toBe("2048x1152");
    expect(resolveOpenAiImageSize("auto")).toBeUndefined();
});

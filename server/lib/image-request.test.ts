import { expect, test } from "bun:test";

import { buildOpenAiImageRequestOptions, resolveOpenAiImageSize } from "./image-request";

test("converts workbench ratio presets to OpenAI pixel dimensions", () => {
    expect(resolveOpenAiImageSize("1:1")).toBe("1024x1024");
    expect(resolveOpenAiImageSize("16:9")).toBe("1024x576");
    expect(resolveOpenAiImageSize("9:16")).toBe("576x1024");
    expect(resolveOpenAiImageSize("1:1", "medium")).toBe("2048x2048");
    expect(resolveOpenAiImageSize("1:1", "high")).toBe("3840x3840");
    expect(resolveOpenAiImageSize("3:2")).toBe("1008x672");
    expect(resolveOpenAiImageSize("16:9", "medium")).toBe("2048x1152");
    expect(resolveOpenAiImageSize("16:9", "high")).toBe("3840x2160");
});

test("preserves explicit pixel dimensions and omits auto sizing", () => {
    expect(resolveOpenAiImageSize("2048x1152")).toBe("2048x1152");
    expect(resolveOpenAiImageSize("auto")).toBeUndefined();
});

test("uses the documented minimal request body for a single image", () => {
    expect(buildOpenAiImageRequestOptions({ count: 1, size: "1024x1024" })).toEqual({ size: "1024x1024", response_format: "b64_json" });
    expect(buildOpenAiImageRequestOptions({ count: 2, quality: "high", size: "2048x2048" })).toEqual({ n: 2, quality: "high", size: "2048x2048", response_format: "b64_json" });
});

test("keeps output resolution independent from provider generation quality", () => {
    const size = resolveOpenAiImageSize("1:1", "medium");
    expect(size).toBe("2048x2048");
    expect(buildOpenAiImageRequestOptions({ count: 1, quality: "high", size })).toEqual({ quality: "high", size: "2048x2048", response_format: "b64_json" });
});

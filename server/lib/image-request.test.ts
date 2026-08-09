import { expect, test } from "bun:test";

import { buildOpenAiImageRequestOptions, imageResponseDataUrl, imageResponseItems, resolveOpenAiImageSize, usesJsonReferenceGeneration } from "./image-request";

const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JdVQAAAAASUVORK5CYII=";

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

test("preserves explicit pixel dimensions and migrates legacy auto sizing to square", () => {
    expect(resolveOpenAiImageSize("2048x1152")).toBe("2048x1152");
    expect(resolveOpenAiImageSize("auto")).toBe("1024x1024");
    expect(resolveOpenAiImageSize("auto", "medium")).toBe("2048x2048");
});

test("fits GPT Image 2 ratios into the official pixel constraints", () => {
    expect(resolveOpenAiImageSize("16:9", "low", "gpt-image-2")).toBe("1280x720");
    expect(resolveOpenAiImageSize("3:1", "low", "gpt-image-2")).toBe("1440x480");
    expect(resolveOpenAiImageSize("1:1", "high", "gpt-image-2")).toBe("2880x2880");
    expect(resolveOpenAiImageSize("21:9", "medium", "gpt-image-2")).toBe("2016x864");
});

test("maps Dragon GPT image models to the provider's documented dimensions", () => {
    expect(resolveOpenAiImageSize("9:16", "low", "gpt-image-2-4k超分", "https://dragtokens.com/")).toBe("720x1280");
    expect(resolveOpenAiImageSize("9:16", "high", "gpt-image-2-原生4k", "https://draw.dragtokens.com")).toBe("2160x3840");
    expect(resolveOpenAiImageSize("3:2", "low", "gpt-image-2", "https://dragtokens.com")).toBe("1536x1024");
    expect(() => resolveOpenAiImageSize("9:16", "low", "gpt-image-2", "https://dragtokens.com")).toThrow("Dragon gpt-image-2 only supports 1:1, 3:2, or 2:3");
});

test("rejects invalid explicit GPT Image 2 dimensions before calling upstream", () => {
    expect(() => resolveOpenAiImageSize("3840x3840", "high", "gpt-image-2")).toThrow("GPT Image 2 size must contain between 655360 and 8294400 pixels");
    expect(() => resolveOpenAiImageSize("512x512", "low", "gpt-image-2")).toThrow("GPT Image 2 size must contain between 655360 and 8294400 pixels");
    expect(resolveOpenAiImageSize("1280x720", "low", "gpt-image-2")).toBe("1280x720");
});

test("maps older GPT Image models to their fixed documented dimensions", () => {
    expect(resolveOpenAiImageSize("1:1", "high", "gpt-image-1.5")).toBe("1024x1024");
    expect(resolveOpenAiImageSize("3:2", "high", "gpt-image-1.5")).toBe("1536x1024");
    expect(resolveOpenAiImageSize("2:3", "high", "gpt-image-1")).toBe("1024x1536");
    expect(() => resolveOpenAiImageSize("2048x2048", "high", "gpt-image-1.5")).toThrow("Legacy GPT Image models only support");
});

test("uses the documented minimal request body for a single image", () => {
    expect(buildOpenAiImageRequestOptions({ count: 1, size: "1024x1024" })).toEqual({ size: "1024x1024", response_format: "b64_json" });
    expect(buildOpenAiImageRequestOptions({ count: 2, quality: "high", size: "2048x2048" })).toEqual({ n: 2, quality: "high", size: "2048x2048", response_format: "b64_json" });
    expect(buildOpenAiImageRequestOptions({ count: 1, size: "720x1280", responseFormat: null })).toEqual({ size: "720x1280" });
});

test("keeps output resolution independent from provider generation quality", () => {
    const size = resolveOpenAiImageSize("1:1", "medium");
    expect(size).toBe("2048x2048");
    expect(buildOpenAiImageRequestOptions({ count: 1, quality: "high", outputFormat: "webp", size })).toEqual({ quality: "high", output_format: "webp", size: "2048x2048", response_format: "b64_json" });
});

test("reads common image response arrays", () => {
    expect(imageResponseItems({ data: [{ url: "data" }] })).toEqual([{ url: "data" }]);
    expect(imageResponseItems({ images: [{ url: "images" }] })).toEqual([{ url: "images" }]);
    expect(imageResponseItems({ results: [{ b64_json: "result" }] })).toEqual([{ b64_json: "result" }]);
    expect(imageResponseItems({ data: [], images: [{ url: "fallback" }] })).toEqual([{ url: "fallback" }]);
    expect(imageResponseItems({ data: "invalid" })).toEqual([]);
});

test("accepts a complete data URL returned in b64_json without wrapping it twice", () => {
    const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

    expect(imageResponseDataUrl(dataUrl, "image/jpeg")).toBe(dataUrl);
});

test("wraps a raw base64 image response with its detected MIME type", () => {
    expect(imageResponseDataUrl(ONE_PIXEL_PNG_BASE64, "image/jpeg")).toBe(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);
});

test("uses JSON reference generation only for compatible Seedream requests", () => {
    expect(usesJsonReferenceGeneration("https://ark.cn-beijing.volces.com/api/v3", "doubao-seedream-4", 1, false)).toBe(true);
    expect(usesJsonReferenceGeneration("https://gateway.example.com/v1", "seedream-4", 2, false)).toBe(true);
    expect(usesJsonReferenceGeneration("https://gateway.example.com/v1", "gpt-image-2", 1, false)).toBe(false);
    expect(usesJsonReferenceGeneration("https://ark.cn-beijing.volces.com/api/v3", "doubao-seedream-4", 1, true)).toBe(false);
});

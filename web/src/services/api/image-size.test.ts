import { expect, test } from "bun:test";

import { resolveImageRequestSize } from "./image";

test("maps ratio and selected output resolution to predictable pixels", () => {
    expect(resolveImageRequestSize("low", "auto")).toBe("1024x1024");
    expect(resolveImageRequestSize("medium", "auto")).toBe("2048x2048");
    expect(resolveImageRequestSize("low", "1:1")).toBe("1024x1024");
    expect(resolveImageRequestSize("medium", "1:1")).toBe("2048x2048");
    expect(resolveImageRequestSize("high", "1:1")).toBe("3840x3840");
    expect(resolveImageRequestSize("low", "16:9")).toBe("1024x576");
    expect(resolveImageRequestSize("low", "3:2")).toBe("1008x672");
    expect(resolveImageRequestSize("medium", "16:9")).toBe("2048x1152");
    expect(resolveImageRequestSize("high", "16:9")).toBe("3840x2160");
});

test("keeps explicit custom dimensions untouched", () => {
    expect(resolveImageRequestSize("low", "1024x1024")).toBe("1024x1024");
});

test("fits GPT Image 2 ratios into the documented pixel range", () => {
    expect(resolveImageRequestSize("low", "16:9", "gpt-image-2")).toBe("1280x720");
    expect(resolveImageRequestSize("low", "3:1", "gpt-image-2")).toBe("1440x480");
    expect(resolveImageRequestSize("high", "1:1", "gpt-image-2")).toBe("2880x2880");
    expect(resolveImageRequestSize("medium", "21:9", "gpt-image-2")).toBe("2016x864");
});

test("rejects GPT Image 2 custom dimensions outside the official limits", () => {
    expect(() => resolveImageRequestSize("high", "3840x3840", "gpt-image-2")).toThrow("图像总像素需在 655360 到 8294400 之间");
    expect(() => resolveImageRequestSize("low", "512x512", "gpt-image-2")).toThrow("图像总像素需在 655360 到 8294400 之间");
    expect(resolveImageRequestSize("low", "1280x720", "gpt-image-2")).toBe("1280x720");
});

test("maps older GPT Image models to their fixed documented dimensions", () => {
    expect(resolveImageRequestSize("high", "1:1", "gpt-image-1.5")).toBe("1024x1024");
    expect(resolveImageRequestSize("high", "3:2", "gpt-image-1.5")).toBe("1536x1024");
    expect(resolveImageRequestSize("high", "2:3", "gpt-image-1")).toBe("1024x1536");
    expect(() => resolveImageRequestSize("low", "2048x2048", "gpt-image-1.5")).toThrow("旧版 GPT Image 仅支持");
});

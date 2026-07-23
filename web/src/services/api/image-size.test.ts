import { expect, test } from "bun:test";

import { resolveImageRequestSize } from "./image";

test("maps ratio and selected output resolution to predictable pixels", () => {
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

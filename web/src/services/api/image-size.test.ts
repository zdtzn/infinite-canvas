import { expect, test } from "bun:test";

import { resolveImageRequestSize } from "./image";

test("uses a compatible 2K minimum for UU gpt-image-2 ratio presets", () => {
    expect(resolveImageRequestSize({ baseUrl: "https://api.uuapi.net/v1", model: "gpt-image-2", quality: "auto", size: "1:1" })).toBe("2048x2048");
    expect(resolveImageRequestSize({ baseUrl: "https://api.uuapi.net/v1", model: "gpt-image-2", quality: "auto", size: "16:9" })).toBe("2048x1152");
    expect(resolveImageRequestSize({ baseUrl: "https://api.uuapi.net/v1", model: "gpt-image-2", quality: "auto", size: "1024x1024" })).toBe("1024x1024");
});

test("keeps the default 1K ratio mapping for other image channels", () => {
    expect(resolveImageRequestSize({ baseUrl: "https://api.example.com/v1", model: "gpt-image-2", quality: "auto", size: "1:1" })).toBe("1024x1024");
});

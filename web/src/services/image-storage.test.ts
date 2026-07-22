import { afterEach, expect, test } from "bun:test";

import { readImageBlob } from "./image-storage";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("reads generated image files with the active session", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input, init) => {
        request = { input, init };
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;

    const blob = await readImageBlob("/api/job-files/job/image.png");

    expect(blob.type).toBe("image/png");
    expect(request).toEqual({ input: "/api/job-files/job/image.png", init: { credentials: "same-origin" } });
});

test("reports a useful error when the generated image can no longer be read", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "图片不存在" } }), { status: 404, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    await expect(readImageBlob("/api/job-files/missing/image.png")).rejects.toThrow("读取图片失败");
});

import { expect, test } from "bun:test";

import { buildUuAsyncImageRequest, isUuImageAsyncChannel, readUuAsyncTask, resolveUuAsyncImageSize } from "./uu-image-async";

test("uses the UU async API only for compatible gpt-image-2 jobs", () => {
    expect(isUuImageAsyncChannel("https://uuapi.cc/v1", "gpt-image-2", 0, false)).toBe(true);
    expect(isUuImageAsyncChannel("https://api.uuapi.net", "GPT-IMAGE-2", 1, false)).toBe(true);
    expect(isUuImageAsyncChannel("https://api.example.com", "gpt-image-2", 0, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-1", 0, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-2", 2, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-2", 1, true)).toBe(false);
});

test("converts workbench sizing into UU async width and height", () => {
    expect(resolveUuAsyncImageSize("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(resolveUuAsyncImageSize("16:9")).toEqual({ width: 1824, height: 1024 });
    expect(resolveUuAsyncImageSize("1:1", "medium")).toEqual({ width: 2048, height: 2048 });
    expect(resolveUuAsyncImageSize("auto")).toEqual({ width: 1024, height: 1024 });
});

test("builds UU async form fields for text and image modes", () => {
    expect(buildUuAsyncImageRequest({ size: "16:9", referenceCount: 0 })).toEqual({ mode: "text", width: 1824, height: 1024 });
    expect(buildUuAsyncImageRequest({ size: "1:1", quality: "medium", referenceCount: 1 })).toEqual({ mode: "image", width: 2048, height: 2048 });
});

test("normalizes a pending UU task response", () => {
    expect(
        readUuAsyncTask({
            data: { task: { task_id: "task-pending", status: "pending", expires_at: "2026-07-29T00:00:00Z" } },
        }),
    ).toEqual({ taskId: "task-pending", status: "pending", expiresAt: "2026-07-29T00:00:00Z", imageUrls: [], message: undefined });
});

test("reads completed UU task images and task failures", () => {
    expect(
        readUuAsyncTask({
            data: { task: { task_id: "task-done", status: "succeeded", images: [{ url: "https://cdn.example.com/result.png" }] } },
        }),
    ).toEqual({ taskId: "task-done", status: "succeeded", expiresAt: undefined, imageUrls: ["https://cdn.example.com/result.png"], message: undefined });

    expect(
        readUuAsyncTask({
            task: { task_id: "task-failed", status: "failed", error: { message: "upstream rejected the prompt" } },
        }),
    ).toEqual({ taskId: "task-failed", status: "failed", expiresAt: undefined, imageUrls: [], message: "upstream rejected the prompt" });
});

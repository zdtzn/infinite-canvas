import { expect, test } from "bun:test";

import { UuImageChannelScheduler, buildUuAsyncImageForm, buildUuAsyncImageRequest, hasUuAsyncTask, isUuAsyncGptImage2Channel, isUuImageAsyncChannel, readUuAsyncTask, resolveUuAsyncImageSize } from "./uu-image-async";

test("uses the UU async API only for compatible gpt-image-2 jobs", () => {
    expect(isUuImageAsyncChannel("https://uuapi.cc/v1", "gpt-image-2", 0, false)).toBe(true);
    expect(isUuImageAsyncChannel("https://api.uuapi.net", "GPT-IMAGE-2", 1, false)).toBe(true);
    expect(isUuImageAsyncChannel("https://api.example.com", "gpt-image-2", 0, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-1", 0, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-2", 2, false)).toBe(false);
    expect(isUuImageAsyncChannel("https://uuapi.cc", "gpt-image-2", 1, true)).toBe(false);
});

test("identifies the UU gpt-image-2 channel independently of job mode", () => {
    expect(isUuAsyncGptImage2Channel("https://uuapi.net/v1", "gpt-image-2")).toBe(true);
    expect(isUuAsyncGptImage2Channel("https://uuapi.net/v1", "gpt-image-1")).toBe(false);
});

test("converts workbench sizing into UU async width and height", () => {
    expect(resolveUuAsyncImageSize("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(resolveUuAsyncImageSize("16:9")).toEqual({ width: 1280, height: 720 });
    expect(resolveUuAsyncImageSize("9:16")).toEqual({ width: 720, height: 1280 });
    expect(resolveUuAsyncImageSize("1:1", "medium")).toEqual({ width: 2048, height: 2048 });
    expect(resolveUuAsyncImageSize("1:1", "high")).toEqual({ width: 2880, height: 2880 });
    expect(resolveUuAsyncImageSize("3:2")).toEqual({ width: 1008, height: 672 });
    expect(resolveUuAsyncImageSize("1024x1024")).toEqual({ width: 1024, height: 1024 });
    expect(resolveUuAsyncImageSize("auto")).toEqual({ width: 1024, height: 1024 });
});

test("builds UU async form fields for text and image modes", () => {
    expect(buildUuAsyncImageRequest({ size: "16:9", referenceCount: 0 })).toEqual({ mode: "text", sizeTier: "2K", width: 1280, height: 720 });
    expect(buildUuAsyncImageRequest({ size: "1:1", quality: "medium", referenceCount: 1 })).toEqual({ mode: "image", sizeTier: "2K", width: 2048, height: 2048 });
    expect(buildUuAsyncImageRequest({ size: "1:1", quality: "high", referenceCount: 1 })).toEqual({ mode: "image", sizeTier: "4K", width: 2880, height: 2880 });
});

test("matches the UU image studio multipart fields for reference generation", () => {
    const reference = new Blob(["reference"], { type: "image/png" });
    const form = buildUuAsyncImageForm({
        model: "gpt-image-2",
        prompt: "edit the reference",
        size: "1:1",
        quality: "low",
        references: [reference],
    });

    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("mode")).toBe("image");
    expect(form.get("prompt")).toBe("edit the reference");
    expect(form.get("size_tier")).toBe("1K");
    expect(form.get("width")).toBe("1024");
    expect(form.get("height")).toBe("1024");
    expect(form.getAll("images")).toHaveLength(1);
    expect(form.getAll("image")).toHaveLength(1);
    expect((form.get("images") as File).name).toBe("reference-1.png");
    expect((form.get("image") as File).name).toBe("reference-1.png");
});

test("keeps the reference filename extension aligned with its MIME type", () => {
    const reference = new Blob(["reference"], { type: "image/jpeg" });
    const form = buildUuAsyncImageForm({
        model: "gpt-image-2",
        prompt: "edit the reference",
        size: "1:1",
        quality: "low",
        references: [reference],
    });

    expect((form.get("images") as File).name).toBe("reference-1.jpg");
    expect((form.get("images") as File).type).toBe("image/jpeg");
    expect((form.get("image") as File).name).toBe("reference-1.jpg");
});

test("resumes the async endpoint only for an existing UU task", () => {
    const input = {
        userId: "user",
        channelId: "uu",
        apiFormat: "openai" as const,
        model: "gpt-image-2",
        prompt: "test",
        count: 1,
        references: [],
    };

    expect(hasUuAsyncTask(input)).toBe(false);
    expect(
        hasUuAsyncTask({
            ...input,
            upstream: { provider: "uu-image", taskId: "task-existing", status: "running" },
        }),
    ).toBe(true);
});

test("serializes UU generation per channel without blocking another channel", async () => {
    const scheduler = new UuImageChannelScheduler(1);
    const signal = new AbortController().signal;
    let releaseFirst = () => undefined;
    let secondStarted = false;
    let otherChannelStarted = false;

    const first = scheduler.run(
        "uu-a",
        signal,
        () =>
            new Promise<void>((resolve) => {
                releaseFirst = resolve;
            }),
    );
    await Bun.sleep(0);
    const second = scheduler.run("uu-a", signal, async () => {
        secondStarted = true;
    });
    await scheduler.run("uu-b", signal, async () => {
        otherChannelStarted = true;
    });

    expect(secondStarted).toBe(false);
    expect(otherChannelStarted).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
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

    expect(
        readUuAsyncTask({
            code: 0,
            message: "success",
            data: { task_id: "task-rate-limited", status: "failed", error_message: "图片生成失败：上游服务请求过于频繁，请稍后重试。" },
        }),
    ).toEqual({ taskId: "task-rate-limited", status: "failed", expiresAt: undefined, imageUrls: [], message: "图片生成失败：上游服务请求过于频繁，请稍后重试。" });
});

test("does not treat an outer success acknowledgement as a completed task", () => {
    expect(
        readUuAsyncTask({
            status: "success",
            message: "success",
            data: { task_id: "task-created", status: "success" },
        }),
    ).toEqual({ taskId: "task-created", status: "pending", expiresAt: undefined, imageUrls: [], message: undefined });
});

test("reads UU image results from common completed task payloads", () => {
    expect(
        readUuAsyncTask({
            status: "success",
            message: "success",
            data: {
                task_id: "task-result",
                status: "completed",
                result: { data: [{ image_url: "https://cdn.example.com/result.webp" }] },
            },
        }),
    ).toEqual({ taskId: "task-result", status: "succeeded", expiresAt: undefined, imageUrls: ["https://cdn.example.com/result.webp"], message: undefined });
});

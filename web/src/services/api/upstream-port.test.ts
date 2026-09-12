import { afterEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import { requestEdit } from "./image";
import { createVideoGenerationTask, requestVideoGeneration } from "./video";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { resolveVideoMode, videoImageLabel } from "@/lib/video-reference-mode";
import { getPluginAuthoringPrompt, runModelPlugin } from "./model-plugin";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const image = { id: "img", name: "参考.png", dataUrl: png, type: "image/png" };
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
    mocks.splice(0).forEach((item) => item.mockRestore());
});
function config(capability: "image" | "video", apiFormat: "openai" | "gemini" = "openai") {
    const name = capability === "video" ? "test-video" : apiFormat === "gemini" ? "gemini-3-pro-image-preview" : "gpt-image-2";
    const channel = createModelChannel({ id: "test", baseUrl: "https://provider.test", apiKey: "test-only", apiFormat, models: [{ name, capability }] });
    return { ...defaultConfig, channelMode: "local" as const, channels: [channel], model: encodeChannelModel(channel.id, name), imageModel: capability === "image" ? encodeChannelModel(channel.id, name) : "", count: "1", size: "16:9", quality: "medium" };
}

test("image edits use image for one reference and image[] for multiple without dropping files", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { data: [{ b64_json: png.split(",")[1] }] } });
    mocks.push(post);
    await requestEdit(config("image"), "test", [image]);
    const single = post.mock.calls[0][1] as FormData;
    expect(single.getAll("image")).toHaveLength(1);
    expect(single.has("image[]")).toBe(false);
    await requestEdit(config("image"), "test", [image, { ...image, id: "img2" }]);
    const multi = post.mock.calls[1][1] as FormData;
    expect(multi.getAll("image[]")).toHaveLength(2);
    expect(multi.has("image")).toBe(false);
});

test("Gemini request places aspect ratio and resolution directly in generationConfig.imageConfig", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } });
    mocks.push(post);
    await requestEdit(config("image", "gemini"), "test", [image]);
    const payload = post.mock.calls[0][1] as { generationConfig: Record<string, unknown> };
    expect(payload.generationConfig.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
    expect(payload.generationConfig).not.toHaveProperty("responseFormat");
});

test("video reference modes preserve old multipart requests and explicitly map first/last frames", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { id: "task" } });
    mocks.push(post);
    await createVideoGenerationTask(config("video"), "test", [image]);
    expect((post.mock.calls[0][1] as FormData).getAll("input_reference[]")).toHaveLength(1);
    await createVideoGenerationTask({ ...config("video"), videoMode: "frames" }, "test", [image, { ...image, id: "img2" }]);
    const frames = post.mock.calls[1][1] as FormData;
    expect(frames.get("mode")).toBe("frames");
    expect(frames.get("first_frame")).toBeInstanceOf(File);
    expect(frames.get("last_frame")).toBeInstanceOf(File);
    await createVideoGenerationTask({ ...config("video"), videoMode: "frames" }, "test", [image, image, image]);
    expect((post.mock.calls[2][1] as FormData).getAll("image[]")).toHaveLength(3);
    expect(resolveVideoMode("frames", 1, 1)).toBe("reference");
    expect(videoImageLabel("frames", 2, 1)).toBe("尾帧");
});

test("remote task callback runs before polling and rejected tasks are terminal", async () => {
    const events: string[] = [];
    const post = spyOn(axios, "post").mockImplementation(async () => {
        events.push("create");
        return { data: { id: "remote" } };
    });
    mocks.push(post);
    const get = spyOn(axios, "get").mockImplementation(async () => {
        events.push("poll");
        return { data: { id: "remote", status: "failed", error: { message: "rejected" } } };
    });
    mocks.push(get);
    await expect(
        requestVideoGeneration(config("video"), "test", [], [], [], {
            onTaskCreated: (task) => {
                expect(task.id).toBe("remote");
                events.push("persist");
            },
        }),
    ).rejects.toMatchObject({ name: "VideoTaskFailed" });
    expect(events).toEqual(["create", "persist", "poll"]);
    expect(post).toHaveBeenCalledTimes(1);
});

test("old scripts still run and new scripts receive video/audio files without keys in authoring prompt", async () => {
    expect(await runModelPlugin({ config: config("video"), capability: "video", script: "return prompt;", prompt: "legacy" })).toBe("legacy");
    const file = new File(["x"], "ref.mp4", { type: "video/mp4" });
    expect(await runModelPlugin({ config: config("video"), capability: "video", script: "return [videos[0].name, audios.length];", videos: [file] })).toEqual(["ref.mp4", 0]);
    expect(getPluginAuthoringPrompt("video", "test-video")).not.toContain("test-only");
});

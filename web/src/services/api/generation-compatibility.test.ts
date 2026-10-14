import { afterEach, expect, spyOn, test } from "bun:test";
import axios from "axios";

import { createModelChannel, defaultConfig, encodeChannelModel, type ChannelModel } from "@/stores/use-config-store";
import { requestEdit, requestGeneration, requestImageQuestion } from "./image";
import { PLUGIN_TEMPLATES } from "./model-plugin";
import { createVideoGenerationTask, pollVideoGenerationTask } from "./video";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const reference = { id: "reference", name: "reference.png", dataUrl: png, type: "image/png" };
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => mocks.splice(0).forEach((mock) => mock.mockRestore()));

function config(model: ChannelModel, apiFormat: "gemini" | "openai" = "openai") {
    const channel = createModelChannel({ id: "test", apiKey: "fixture-only", baseUrl: "https://provider.invalid", apiFormat, models: [model] });
    const selected = encodeChannelModel(channel.id, model.name);
    return { ...defaultConfig, channels: [channel], model: selected, imageModel: selected, videoModel: selected, quality: "medium", size: "16:9", count: "1" };
}

test("missing selections block image, text and video generation and saved task queries before HTTP", async () => {
    const selected = config({ name: "remaining", capability: "image" });
    const model = encodeChannelModel("test", "removed");
    const removed = { ...selected, model, imageModel: model, videoModel: model };
    const post = spyOn(axios, "post").mockRejectedValue(new Error("must not request"));
    const get = spyOn(axios, "get").mockRejectedValue(new Error("must not request"));
    mocks.push(post, get);

    await expect(requestGeneration(removed, "fixture")).rejects.toThrow("已不可用");
    await expect(requestEdit(removed, "fixture", [reference])).rejects.toThrow("已不可用");
    await expect(requestImageQuestion(removed, [], () => {})).rejects.toThrow("已不可用");
    await expect(createVideoGenerationTask(removed, "fixture")).rejects.toThrow("已不可用");
    await expect(pollVideoGenerationTask(removed, { id: "saved", provider: "openai", model })).rejects.toThrow("已不可用");
    const missingChannel = { ...removed, channels: [] };
    await expect(pollVideoGenerationTask(missingChannel, { id: "saved", provider: "seedance", model })).rejects.toThrow("已不可用");
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
});

test("Gemini aliases send declared resolutions while explicit automatic support omits imageSize", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } });
    mocks.push(post);
    for (const [name, resolutions] of [
        ["vendor-alias", ["medium"]],
        ["gemini-3-pro-image-preview", ["auto"]],
        ["vendor-3.1-image", ["auto"]],
    ] as const) {
        const selected = config({ name, capability: "image", imageCapabilities: { mode: "custom", resolutions: [...resolutions], sizes: ["16:9"] } }, "gemini");
        await requestGeneration(selected, "fixture");
        const payload = post.mock.calls.at(-1)![1] as { generationConfig: { imageConfig: Record<string, unknown> } };
        expect(payload.generationConfig.imageConfig).toEqual({ aspectRatio: "16:9", ...(resolutions[0] === "medium" ? { imageSize: "2K" } : {}) });
    }
});

test("generic videos preserve every reference field and carry ratio and selected resolution", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { id: "created" } });
    mocks.push(post);
    const selected = config({ name: "vendor-video", capability: "video" });
    for (const videoMode of ["", "frames", "reference"]) {
        await createVideoGenerationTask({ ...selected, videoMode, size: "9:16", vquality: "1080" }, "fixture", [reference, { ...reference, id: "second" }]);
        const body = post.mock.calls.at(-1)![1] as FormData;
        expect(body.get("size")).toBe("1080x1920");
        expect(body.get("ratio")).toBe("9:16");
        expect(body.get("resolution_name")).toBe("1080p");
        expect(body.getAll("images")).toHaveLength(2);
        if (videoMode === "frames") {
            expect(body.get("first_frame")).toBeInstanceOf(File);
            expect(body.get("last_frame")).toBeInstanceOf(File);
        } else expect(body.getAll(videoMode ? "image[]" : "input_reference[]")).toHaveLength(2);
    }
    for (const [size, resolution, pixels, ratio] of [
        ["4:3", "480", "640x480", "4:3"],
        ["1:1", "720p", "720x720", "1:1"],
        ["1280x720", "1080", "1280x720", "16:9"],
        ["auto", "1080", null, "16:9"],
    ]) {
        await createVideoGenerationTask({ ...selected, size: size!, vquality: resolution! }, "fixture");
        const body = post.mock.calls.at(-1)![1] as FormData;
        expect(body.get("size")).toBe(pixels);
        expect(body.get("ratio")).toBe(ratio);
    }
});

test("Seedance keeps its dedicated JSON task endpoint, ratio and account binding", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { id: "seedance-created" } });
    mocks.push(post);
    const selected = config({ name: "doubao-seedance-2-0", capability: "video" });
    const task = await createVideoGenerationTask({ ...selected, size: "9:16", vquality: "1080" }, "fixture", [], [], [], { expectedUserId: "alice" });
    expect(post.mock.calls[0][0]).toBe("https://provider.invalid/v1/contents/generations/tasks");
    expect(post.mock.calls[0][1]).toMatchObject({ model: "doubao-seedance-2-0", ratio: "9:16", resolution: "1080p" });
    expect(task).toMatchObject({ provider: "seedance", ownerUserId: "alice" });
});

test("OpenAI image script template preserves multiple reference files and provider quality", async () => {
    const request = spyOn(axios, "request").mockResolvedValue({ data: { data: [{ b64_json: png.split(",")[1] }] } });
    mocks.push(request);
    const selected = config({ name: "gpt-image-2", capability: "image", script: PLUGIN_TEMPLATES.image[0].script });
    await requestEdit({ ...selected, imageQuality: "high" }, "fixture", [reference, { ...reference, id: "second" }]);
    const body = request.mock.calls[0][0].data as FormData;
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.has("image")).toBe(false);
    expect(body.get("quality")).toBe("high");
    expect(body.get("size")).toBe("2048x1152");
});

test("Gemini image script template receives ratio and resolution independently from generation quality", async () => {
    const request = spyOn(axios, "request").mockResolvedValue({ data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } });
    mocks.push(request);
    const selected = config({ name: "vendor-alias", capability: "image", script: PLUGIN_TEMPLATES.image[1].script, imageCapabilities: { mode: "custom", resolutions: ["medium"], sizes: ["16:9"] } }, "gemini");
    await requestGeneration(selected, "fixture");
    expect(request.mock.calls[0][0].data.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } });
});

test("native Gemini generation and editing accept every advertised panoramic ratio", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } });
    mocks.push(post);
    const selected = config({ name: "gemini-3.1-flash-image-preview", capability: "image" }, "gemini");
    for (const size of ["4:1", "1:4", "8:1", "1:8"]) {
        for (const edit of [false, true]) {
            await (edit ? requestEdit({ ...selected, size }, "fixture", [reference]) : requestGeneration({ ...selected, size }, "fixture"));
            expect(post.mock.calls.at(-1)![1].generationConfig.imageConfig.aspectRatio).toBe(size);
        }
    }
});

test("Gemini image templates accept panoramic ratios without applying OpenAI pixel limits", async () => {
    const request = spyOn(axios, "request").mockResolvedValue({ data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } });
    mocks.push(request);
    const selected = config({ name: "gemini-3.1-flash-image-preview", capability: "image", script: PLUGIN_TEMPLATES.image[1].script }, "gemini");
    for (const size of ["4:1", "1:4", "8:1", "1:8"]) {
        for (const edit of [false, true]) {
            await (edit ? requestEdit({ ...selected, size }, "fixture", [reference]) : requestGeneration({ ...selected, size }, "fixture"));
            expect(request.mock.calls.at(-1)![0].data.generationConfig.imageConfig.aspectRatio).toBe(size);
        }
    }
    const openai = config({ name: "gpt-image-2", capability: "image", imageCapabilities: { mode: "custom", sizes: ["4:1"] } });
    await expect(requestGeneration({ ...openai, size: "4:1" }, "fixture")).rejects.toThrow("宽高比不能超过 3:1");
});

test("Gemini templates normalize custom pixels like native calls and keep resolution automatic", async () => {
    const response = { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] } }] } };
    const post = spyOn(axios, "post").mockResolvedValue(response);
    const request = spyOn(axios, "request").mockResolvedValue(response);
    mocks.push(post, request);
    for (const script of [undefined, PLUGIN_TEMPLATES.image[1].script]) {
        const selected = config({ name: "vendor-alias", capability: "image", script, imageCapabilities: { mode: "custom", customSize: true, resolutions: ["auto", "medium"], sizes: ["1:1", "2:3"] } }, "gemini");
        for (const quality of ["medium", "auto"]) {
            for (const edit of [false, true]) {
                const configured = { ...selected, size: "1024x1536", quality };
                await (edit ? requestEdit(configured, "fixture", [reference]) : requestGeneration(configured, "fixture"));
                const payload = script ? request.mock.calls.at(-1)![0].data : post.mock.calls.at(-1)![1];
                expect(payload.generationConfig.imageConfig).toEqual({ aspectRatio: "2:3", ...(quality === "medium" ? { imageSize: "2K" } : {}) });
            }
        }
    }
});

test("OpenAI scripts retain their raw pixel ratio and calculated size parameters", async () => {
    const request = spyOn(axios, "request").mockResolvedValue({ data: {} });
    mocks.push(request);
    const selected = config({ name: "gpt-image-2", capability: "image", script: `await http.post("/fixture", params); return ["${png}"];` });
    for (const edit of [false, true]) {
        const configured = { ...selected, size: "1024x1536" };
        await (edit ? requestEdit(configured, "fixture", [reference]) : requestGeneration(configured, "fixture"));
        expect(request.mock.calls.at(-1)![0].data).toMatchObject({ size: "1024x1536", ratio: "1024x1536", resolution: "medium" });
    }
});

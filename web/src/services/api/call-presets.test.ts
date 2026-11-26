import { afterEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { CALL_PRESETS } from "./call-presets";
import { createVideoGenerationTask, pollVideoGenerationTask } from "./video";
import { runModelPlugin } from "./model-plugin";
import { useUserStore } from "@/stores/use-user-store";

const mocks: { mockRestore(): void }[] = [];
afterEach(() => mocks.splice(0).forEach(mock => mock.mockRestore()));

function config(id: string, name = "model") {
    const preset = CALL_PRESETS.find(item => item.id === id)!;
    const channel = createModelChannel({ id: "provider", apiKey: "fixture-only-credential", baseUrl: "https://provider.invalid/v1", models: [{ name, capability: preset.capability, script: preset.source }] });
    const selected = encodeChannelModel(channel.id, name);
    return { ...defaultConfig, channelMode: "local" as const, channels: [channel], model: selected, videoModel: selected, vquality: "720p", size: "16:9", videoSeconds: "5" };
}

const protocols = [
    { id: "agnes-video", created: { video_id: "task-one" }, result: { status: "completed", url: "https://media.invalid/result.mp4" }, path: "/agnesapi" },
    { id: "kling-video", created: { code: 0, data: { task_id: "task-one" } }, result: { code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: "https://media.invalid/result.mp4" }] } } }, path: "/videos/text2video/task-one" },
    { id: "wan-video", created: { output: { task_id: "task-one" } }, result: { output: { task_status: "SUCCEEDED", video_url: "https://media.invalid/result.mp4" } }, path: "/tasks/task-one" },
    { id: "vidu-video", created: { task_id: "task-one" }, result: { state: "success", creations: [{ url: "https://media.invalid/result.mp4" }] }, path: "/tasks/task-one/creations" },
    { id: "grok2api-video", created: { request_id: "task-one" }, result: { status: "done", video: { url: "https://media.invalid/result.mp4", respect_moderation: true } }, path: "/videos/task-one" },
    { id: "grok-video-generations", created: { request_id: "task-one" }, result: { status: "done", video: { url: "https://media.invalid/result.mp4", respect_moderation: true } }, path: "/videos/task-one" },
];
for (const protocol of protocols) test(`${protocol.id} persists the provider id and resumes queries without another submission or saved credentials`, async () => {
    const requests: { method?: string; url?: string }[] = [];
    const request = spyOn(axios, "request").mockImplementation(async options => {
        requests.push(options);
        return { data: options.method === "post" ? protocol.created : protocol.result };
    });
    mocks.push(request);
    const selected = config(protocol.id, protocol.id === "wan-video" ? "wan2.7-t2v" : "model");
    const task = await createVideoGenerationTask(selected, "模拟生成");
    expect(task.provider).toBe("script");
    expect(JSON.stringify(task)).not.toContain("fixture-only-credential");
    const restored = JSON.parse(JSON.stringify(task));
    for (let repeat = 0; repeat < 2; repeat++) {
        const state = await pollVideoGenerationTask(selected, restored);
        expect(state.status).toBe("completed");
        if (state.status === "completed") expect(state.result.url).toBe("https://media.invalid/result.mp4");
    }
    expect(requests.filter(item => item.method === "post")).toHaveLength(1);
    expect(requests[1].url).toContain(protocol.path);
});

test("changing the script or account blocks a recovered video before any HTTP request", async () => {
    const selected = config("wan-video", "wan2.7-t2v");
    const task = { id: "task", provider: "script" as const, script: selected.channels[0].models[0].script, model: selected.model, ownerUserId: "different-user" };
    const request = spyOn(axios, "request").mockRejectedValue(new Error("must not request"));
    mocks.push(request);
    await expect(pollVideoGenerationTask(selected, task)).rejects.toThrow("账号");
    await expect(pollVideoGenerationTask(selected, { ...task, ownerUserId: useUserStore.getState().user?.id || "", script: task.script + "\n// changed" })).rejects.toThrow("调用方式已变更");
    expect(request).not.toHaveBeenCalled();
});

test("MiniMax queries the original task then resolves its file without another creation", async () => {
    const requests: { method?: string; url?: string; params?: unknown }[] = [];
    const request = spyOn(axios, "request").mockImplementation(async options => {
        requests.push(options);
        if (options.method === "post") return { data: { base_resp: { status_code: 0 }, task_id: "minimax-task" } };
        if (options.url?.includes("/files/retrieve")) return { data: { base_resp: { status_code: 0 }, file: { download_url: "https://media.invalid/minimax.mp4" } } };
        return { data: { base_resp: { status_code: 0 }, status: "Success", file_id: "result-file" } };
    });
    mocks.push(request);
    const selected = config("hailuo-video");
    const task = await createVideoGenerationTask(selected, "模拟");
    const result = await pollVideoGenerationTask(selected, JSON.parse(JSON.stringify(task)));
    expect(result.status).toBe("completed");
    expect(requests[1].url).toContain("task_id=minimax-task");
    expect(requests[2].params).toEqual({ file_id: "result-file" });
    expect(requests.filter(item => item.method === "post")).toHaveLength(1);
});

test("Grok JSON image edits keep multiple image inputs and separate quality from resolution", async () => {
    const selected = config("grok-image");
    const request = spyOn(axios, "request").mockResolvedValue({ data: { data: [{ url: "https://media.invalid/image.png" }] } });
    mocks.push(request);
    const channel = selected.channels[0];
    const images = ["data:image/png;base64,AA==", "data:image/png;base64,AQ=="];
    await runModelPlugin({ capability: "image", config: { ...selected, model: "model", apiKey: channel.apiKey, baseUrl: channel.baseUrl }, script: channel.models[0].script!, prompt: "模拟", images, params: { quality: "medium", resolution: "high", ratio: "16:9", count: 1 } });
    const options = request.mock.calls[0][0];
    expect(options.url).toEndWith("/v1/images/edits");
    expect(options.data).toMatchObject({ quality: "medium", resolution: "4k", images: images.map(url => ({ type: "image_url", url })) });
    expect(options.data).not.toBeInstanceOf(FormData);
});

test("protocols requiring public references reject local images before submitting", async () => {
    const selected = config("vidu-video");
    const request = spyOn(axios, "request").mockRejectedValue(new Error("must not request"));
    mocks.push(request);
    await expect(createVideoGenerationTask(selected, "模拟", [{ id: "image", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" }])).rejects.toThrow("公开访问");
    expect(request).not.toHaveBeenCalled();
});

test("Messages protocol handles SSE events split across bytes and sends native authentication", async () => {
    const selected = config("anthropic-text");
    const channel = selected.channels[0];
    let headers: Record<string, string> = {};
    const data = new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"中文"}}\n\ndata: {"type":"message_stop"}\n\n');
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        headers = init!.headers as Record<string, string>;
        return new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    });
    mocks.push(fetch);
    const result = await runModelPlugin({ capability: "text", config: { ...selected, model: "model", apiKey: channel.apiKey, baseUrl: channel.baseUrl }, script: channel.models[0].script!, messages: [{ role: "user", content: "模拟" }], onDelta() {} });
    expect(result).toBe("中文");
    expect(headers["x-api-key"]).toBe("fixture-only-credential");
    expect(headers.Authorization).toBeUndefined();
});

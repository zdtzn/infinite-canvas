import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import { createVideoGenerationTask, pollVideoGenerationTask } from "@/services/api/video";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { runSiteTool } from "./agent-site-tools";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const references = ["first", "last"].map((id) => ({ id, name: `${id}.png`, type: "image/png", dataUrl: png }));
const alice = { id: "alice", username: "alice", displayName: "Alice", avatarUrl: "" };
const originalAdapter = axios.defaults.adapter;
let originalConfig: ReturnType<typeof useConfigStore.getState>;
let originalWorkbench: ReturnType<typeof useWorkbenchAgentStore.getState>;
let originalUser: ReturnType<typeof useUserStore.getState>["user"];
let requests: InternalAxiosRequestConfig[];

function videoConfig(model = "vendor-video", baseUrl = "https://video.invalid", managed = false): AiConfig {
    const channel = createModelChannel({ id: "agent-video-test", baseUrl, apiKey: managed ? "" : "fixture-only", credentialState: managed ? "saved" : "missing", models: [{ name: model, capability: "video" }] });
    const selected = encodeChannelModel(channel.id, model);
    return { ...defaultConfig, channels: [channel], model: selected, videoModel: selected, size: "1280x720", videoSeconds: "6", vquality: "720", quality: "medium", imageQuality: "high", imageOutputFormat: "webp", videoMode: "" };
}

function currentRequestConfig() {
    const config = useConfigStore.getState().config;
    return { ...config, model: config.videoModel || config.model };
}

beforeEach(() => {
    originalConfig = useConfigStore.getState();
    originalWorkbench = useWorkbenchAgentStore.getState();
    originalUser = useUserStore.getState().user;
    useConfigStore.setState({ config: videoConfig() });
    useWorkbenchAgentStore.setState({ videoCommand: null, tasks: [] });
    useUserStore.setState({ user: alice });
    requests = [];
    // Every Axios request is intercepted: no provider or paid generation API is contacted.
    axios.defaults.adapter = (async (request) => {
        requests.push(request);
        return { data: { id: "fixture-created", status: "queued" }, status: 200, statusText: "OK", headers: {}, config: request };
    }) satisfies AxiosAdapter;
});

afterEach(() => {
    axios.defaults.adapter = originalAdapter;
    useConfigStore.setState(originalConfig);
    useWorkbenchAgentStore.setState(originalWorkbench);
    useUserStore.setState({ user: originalUser });
});

describe("Agent 视频模式（HTTP 全部拦截）", () => {
    for (const mode of ["frames", "reference"]) {
        test(`${mode} 从站点工具写入配置并进入视频请求`, async () => {
            const navigate = mock(() => {});
            const result = await runSiteTool("workbench_video_generate", { prompt: "fixture", mode, resolution: "1080", run: false }, navigate) as { applied: { mode: string } };
            expect(result.applied.mode).toBe(mode);
            expect(navigate).toHaveBeenCalledWith("/video");
            expect(useWorkbenchAgentStore.getState().videoCommand).toMatchObject({ prompt: "fixture", run: false });
            expect(requests).toHaveLength(0);
            const config = currentRequestConfig();
            expect(config).toMatchObject({ videoMode: mode, quality: "medium", imageQuality: "high", imageOutputFormat: "webp" });
            await createVideoGenerationTask(config, "fixture", references);
            const body = requests[0].data as FormData;
            expect(body.get("mode")).toBe(mode);
            expect(body.get("resolution_name")).toBe("1080p");
            expect(body.getAll("images")).toHaveLength(2);
            expect(body.has("input_reference[]")).toBe(false);
            if (mode === "frames") {
                expect(body.get("first_frame")).toBeInstanceOf(File);
                expect(body.get("last_frame")).toBeInstanceOf(File);
                expect(body.has("image[]")).toBe(false);
            } else {
                expect(body.getAll("image[]")).toHaveLength(2);
                expect(body.has("first_frame")).toBe(false);
            }
            const read = await runSiteTool("workbench_video_get_config", {}, navigate) as { current: { mode: string }; modeOptions: { value: string }[] };
            expect(read.current.mode).toBe(mode);
            expect(read.modeOptions.map((option) => option.value)).toEqual(["frames", "reference"]);
        });
    }

    test("省略模式保留当前值，空模式继续使用已有请求格式", async () => {
        for (const mode of ["", "frames", "reference"]) {
            useConfigStore.setState({ config: { ...videoConfig(), videoMode: mode } });
            const writes: string[] = [];
            const updateConfig = originalConfig.updateConfig;
            useConfigStore.setState({ updateConfig: (key, value) => { writes.push(key); updateConfig(key, value); } });
            await runSiteTool("workbench_video_generate", { prompt: "fixture", run: false }, mock(() => {}));
            expect(currentRequestConfig().videoMode).toBe(mode);
            expect(writes).not.toContain("videoMode");
        }
        useConfigStore.setState({ config: videoConfig() });
        await createVideoGenerationTask(currentRequestConfig(), "fixture", references);
        const body = requests[0].data as FormData;
        expect(body.has("mode")).toBe(false);
        expect(body.getAll("input_reference[]")).toHaveLength(2);
        expect(body.getAll("images")).toHaveLength(2);
    });

    test("未知模式在写配置、导航、派发或请求前拒绝", async () => {
        const navigate = mock(() => {});
        const config = useConfigStore.getState().config;
        for (const mode of ["invalid", "first-last-frame", "all-reference", "", null, 1]) {
            await expect(runSiteTool("workbench_video_generate", { prompt: "fixture", mode, model: "other", run: true }, navigate)).rejects.toThrow("视频模式 mode 仅支持");
            expect(useConfigStore.getState().config).toBe(config);
        }
        expect(navigate).not.toHaveBeenCalled();
        expect(useWorkbenchAgentStore.getState().videoCommand).toBeNull();
        expect(useWorkbenchAgentStore.getState().tasks).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });

    for (const [model, baseUrl] of [["doubao-seedance-2-0-fast", "https://seedance.invalid"], ["ark-plan-video", "https://ark.cn-beijing.volces.com/api/plan/v3"]]) {
        test(`${model} 保留专用接口、模式角色和账号绑定`, async () => {
            useConfigStore.setState({ config: videoConfig(model, baseUrl, true) });
            for (const mode of ["frames", "reference"]) {
                await runSiteTool("workbench_video_generate", { prompt: "fixture", mode, size: "9:16", seconds: "-1", resolution: "1080", generateAudio: false, watermark: true, run: false }, mock(() => {}));
                const task = await createVideoGenerationTask(currentRequestConfig(), "fixture", references);
                const request = requests.at(-1)!;
                expect(request.url).toBe("/api/ai/agent-video-test/openai/contents/generations/tasks");
                expect(request.headers.get("X-Expected-User-Id")).toBe("alice");
                expect(request.headers.has("Authorization")).toBe(false);
                const body = JSON.parse(request.data) as { content: { type: string; role?: string }[] };
                expect(body).toMatchObject({ ratio: "9:16", duration: -1, generate_audio: false, watermark: true, resolution: model.includes("fast") ? "720p" : "1080p" });
                expect(body.content.filter((item) => item.type === "image_url").map((item) => item.role)).toEqual(mode === "frames" ? ["first_frame", "last_frame"] : ["reference_image", "reference_image"]);
                expect(task).toMatchObject({ provider: "seedance", ownerUserId: "alice" });
                useUserStore.setState({ user: { ...alice, id: "bob" } });
                const count = requests.length;
                await expect(pollVideoGenerationTask(currentRequestConfig(), task)).rejects.toThrow("账号已切换");
                expect(requests).toHaveLength(count);
                useUserStore.setState({ user: alice });
            }
        });
    }

    test("移除的模型继续在任何生成请求前被拒绝", async () => {
        await runSiteTool("workbench_video_generate", { prompt: "fixture", model: encodeChannelModel("agent-video-test", "removed"), mode: "reference", run: false }, mock(() => {}));
        await expect(createVideoGenerationTask(currentRequestConfig(), "fixture")).rejects.toThrow("已不可用");
        expect(requests).toHaveLength(0);
    });
});

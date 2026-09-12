import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import { defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { createVideoGenerationTask, pollVideoGenerationTask, requestVideoGeneration, type VideoGenerationTask } from "./video";

const channel = { ...defaultConfig.channels[0], id: "video-test", baseUrl: "https://video.invalid/v1", apiKey: "fixture-only", models: [{ name: "video", capability: "video" as const }] };
const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "video") };
const task: VideoGenerationTask = { id: "task/with space", provider: "openai", model: config.model, ownerUserId: "alice" };
const alice = { id: "alice", username: "alice", displayName: "Alice", avatarUrl: "" };
const originalAdapter = axios.defaults.adapter;
let originalUser: ReturnType<typeof useUserStore.getState>["user"];
let requests: InternalAxiosRequestConfig[];
let respond: (request: InternalAxiosRequestConfig) => unknown | Promise<unknown>;

beforeEach(() => {
    originalUser = useUserStore.getState().user;
    useUserStore.setState({ user: alice });
    requests = [];
    respond = () => {
        throw new Error("Unexpected HTTP request in isolated video test");
    };
    axios.defaults.adapter = (async (request) => {
        requests.push(request);
        return { data: await respond(request), status: 200, statusText: "OK", headers: {}, config: request };
    }) satisfies AxiosAdapter;
});

afterEach(() => {
    axios.defaults.adapter = originalAdapter;
    useUserStore.setState({ user: originalUser });
});

describe("persisted video task polling (HTTP fully intercepted)", () => {
    test("JSON-restored task polls its encoded ID without creating another generation", async () => {
        respond = () => ({ id: task.id, status: "running" });
        expect(await pollVideoGenerationTask(config, JSON.parse(JSON.stringify(task)))).toEqual({ status: "pending" });
        expect(requests.map((request) => [request.method, request.url])).toEqual([["get", "https://video.invalid/v1/videos/task%2Fwith%20space"]]);
    });

    test("network disconnect rejects but the same persisted task can be polled after reconnect", async () => {
        respond = () => {
            throw new AxiosError("offline", "ERR_NETWORK");
        };
        await expect(pollVideoGenerationTask(config, task)).rejects.toThrow("视频任务查询失败");
        respond = () => ({ id: task.id, status: "running" });
        expect(await pollVideoGenerationTask(config, task)).toEqual({ status: "pending" });
        expect(requests.map((request) => request.method)).toEqual(["get", "get"]);
        expect(task.ownerUserId).toBe("alice");
    });

    test("account switch and logout reject before HTTP, switching back allows recovery", async () => {
        useUserStore.setState({ user: { ...alice, id: "bob" } });
        await expect(pollVideoGenerationTask(config, task)).rejects.toThrow("账号已切换");
        useUserStore.setState({ user: null });
        await expect(pollVideoGenerationTask(config, task)).rejects.toThrow("账号已切换");
        expect(requests).toHaveLength(0);
        useUserStore.setState({ user: alice });
        respond = () => ({ id: task.id, status: "running" });
        expect(await pollVideoGenerationTask(config, task)).toEqual({ status: "pending" });
    });

    test("managed polls send the task owner even if caller supplies another owner", async () => {
        respond = () => ({ id: task.id, status: "running" });
        await pollVideoGenerationTask({ ...config, channels: [{ ...channel, credentialState: "saved" }] }, task, { expectedUserId: "bob" });
        expect(requests[0].url).toBe("/api/ai/video-test/openai/videos/task%2Fwith%20space");
        expect(requests[0].headers.get("X-Expected-User-Id")).toBe("alice");
        expect(requests[0].headers.has("Authorization")).toBe(false);
    });

    test("completion downloads content with owner binding", async () => {
        const blob = new Blob(["fixture"], { type: "video/mp4" });
        respond = (request) => (request.url?.endsWith("/content") ? blob : { id: task.id, status: "completed" });
        expect(await pollVideoGenerationTask(config, task)).toEqual({ status: "completed", result: { blob, ownerUserId: "alice" } });
        expect(requests).toHaveLength(2);
    });

    for (const provider of ["openai", "seedance"] as const) {
        test(`${provider} terminal failure is distinct from a transport error`, async () => {
            respond = () => ({ id: task.id, status: "failed", error: { message: "fixture rejection" } });
            expect(await pollVideoGenerationTask(config, { ...task, provider })).toEqual({ status: "failed", error: "fixture rejection" });
        });
    }

    test("aborted polling issues no HTTP request", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(pollVideoGenerationTask(config, task, { signal: controller.signal })).rejects.toThrow("请求已取消");
        expect(requests).toHaveLength(0);
    });

    test("plugin task can restore a persistent URL without HTTP generation", async () => {
        expect(await pollVideoGenerationTask(config, { ...task, provider: "plugin", result: { url: "https://video.invalid/result.mp4" } })).toEqual({
            status: "completed",
            result: { url: "https://video.invalid/result.mp4", ownerUserId: "alice" },
        });
        expect(requests).toHaveLength(0);
    });

    test("created task is reported before a polling failure so callers can persist it", async () => {
        const captured: VideoGenerationTask[] = [];
        respond = (request) => {
            if (request.method === "post") return { id: "created", status: "queued" };
            throw new AxiosError("offline", "ERR_NETWORK");
        };
        await expect(requestVideoGeneration(config, "fixture", [], [], [], { onTaskCreated: (value) => captured.push(value) })).rejects.toThrow();
        expect(captured).toEqual([{ ...task, id: "created" }]);
        expect(requests.map((request) => request.method)).toEqual(["post", "get"]);
    });

    test("task metadata contains no API credential snapshot", async () => {
        respond = () => ({ id: "created", status: "queued" });
        const created = await createVideoGenerationTask(config, "fixture");
        expect(created.ownerUserId).toBe("alice");
        expect(JSON.stringify(created)).not.toContain(channel.apiKey);
    });
});

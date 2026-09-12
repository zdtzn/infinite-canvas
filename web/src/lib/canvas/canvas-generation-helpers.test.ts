import { describe, expect, test } from "bun:test";

import { assertCanvasVideoTaskOwner, canvasVideoTaskBinding, resetInterruptedGeneration, buildLightingLabel, buildLightingPrompt } from "./canvas-generation-helpers";
import { defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("refresh retains remote video and image jobs but marks unsubmitted jobs interrupted", () => {
    const node: CanvasNodeData = {
        id: "v",
        type: CanvasNodeType.Video,
        title: "video",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { status: "loading", videoTask: { id: "task", provider: "seedance", model: "model", ownerUserId: "user" } },
    };
    const image = { ...node, type: CanvasNodeType.Image, metadata: { status: "loading" as const, jobId: "image-job" } };
    const result = resetInterruptedGeneration([node, image, { ...node, metadata: { status: "loading" } }]);
    expect(result[0]).toBe(node);
    expect(result[1]).toBe(image);
    expect(result[2].metadata?.status).toBe("error");
});

test("video recovery binds account, channel, endpoint, format and mode without saving credentials", () => {
    const channel = { ...defaultConfig.channels[0], id: "video-channel", baseUrl: "https://example.test/v1", apiKey: "private-key", models: [{ name: "video", capability: "video" as const }] };
    const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "video") };
    const metadata = { videoTask: { id: "task", provider: "openai" as const, model: config.model, ownerUserId: "alice" }, videoTaskBinding: canvasVideoTaskBinding(config, config.model) };
    expect(JSON.stringify(metadata)).not.toContain("private-key");
    expect(() => assertCanvasVideoTaskOwner(metadata, config, "alice")).not.toThrow();
    expect(() => assertCanvasVideoTaskOwner(metadata, config, "bob")).toThrow("其他账户");
    expect(() => assertCanvasVideoTaskOwner({ videoTask: metadata.videoTask }, config, "alice")).toThrow("渠道");
    expect(() => assertCanvasVideoTaskOwner(metadata, { ...config, channels: [] }, "alice")).toThrow("渠道");
    expect(() => assertCanvasVideoTaskOwner(metadata, { ...config, channels: [{ ...channel, baseUrl: "https://other.test" }] }, "alice")).toThrow("配置已变化");
    expect(() => assertCanvasVideoTaskOwner(metadata, { ...config, channelMode: config.channelMode === "local" ? "remote" : "local" }, "alice")).toThrow("配置已变化");
});

describe("canvas lighting prompt", () => {
    test("preserves the source composition while expressing selected lighting parameters", () => {
        const params = { mode: "perspective" as const, direction: "back" as const, lightPosition: { x: 0.62, y: -0.44 }, brightness: 82, temperature: 3200 };
        const prompt = buildLightingPrompt(params);

        expect(buildLightingLabel(params)).toBe("AI 打光：后方逆光，亮度 82%，色温 3200K");
        expect(prompt).toContain("严格保持原图主体身份");
        expect(prompt).toContain("文字内容");
        expect(prompt).toContain("后方逆光");
        expect(prompt).toContain("右上方");
        expect(prompt).toContain("水平偏移 62%");
        expect(prompt).toContain("垂直偏移 -44%");
        expect(prompt).toContain("色温 3200K");
        expect(prompt).toContain("偏暖的金橙色光线");
    });
});

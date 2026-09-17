import { describe, expect, test } from "bun:test";

import { assertCanvasVideoTaskOwner, canvasVideoTaskBinding, resetInterruptedGeneration, buildLightingLabel, buildLightingPrompt, buildAngleLabel, buildAnglePrompt } from "./canvas-generation-helpers";
import { defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas angle prompt", () => {
    const params = { horizontalAngle: 0, pitchAngle: 0, cameraDistance: 5, wideAngle: false, target: "scene" as const, preserveText: true, preserveBackground: false };
    test("describes camera position and framing without ambiguous rotation or distance units", () => {
        expect(buildAngleLabel(params)).toBe("AI 多角度：正面视角，水平视角，中景，标准镜头");
        expect(buildAngleLabel({ ...params, horizontalAngle: -45, pitchAngle: -30, cameraDistance: 1 })).toBe("AI 多角度：左侧视角 45 度，仰视 30 度，近景，标准镜头");
        expect(buildAngleLabel({ ...params, horizontalAngle: 60, pitchAngle: 45, cameraDistance: 10, wideAngle: true })).toBe("AI 多角度：右侧视角 60 度，俯视 45 度，远景，广角镜头");
    });
    test("scene defaults retain identity and lettering without freezing perspective", () => {
        const prompt = buildAnglePrompt(params);
        expect(prompt).toContain("相机绕主体移动");
        expect(prompt).toContain("数量、形状比例");
        expect(prompt).toContain("逐字保留");
        expect(prompt).toContain("背景可随新视角自然重构");
        expect(prompt).toContain("未展示的表面仅作合理推测");
    });
    test("subject, background, lens and framing choices actually change the request", () => {
        const prompt = buildAnglePrompt({ ...params, target: "subject", preserveText: false, preserveBackground: true, wideAngle: true, cameraDistance: 10 });
        expect(prompt).toContain("仅调整主体或商品");
        expect(prompt).toContain("多个主体一同调整");
        expect(prompt).toContain("保留原背景");
        expect(prompt).not.toContain("逐字保留");
        expect(prompt).toContain("避免鱼眼");
        expect(prompt).toContain("远景：完整展示主体");
        expect(buildAnglePrompt({ ...params, cameraDistance: 1 })).toContain("近景：突出主体细节");
    });
});

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

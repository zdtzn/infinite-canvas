import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { spyOn } from "bun:test";
import axios from "axios";

import { canvasThemes } from "@/lib/canvas-theme";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { createVideoGenerationTask } from "@/services/api/video";
import { normalizeVideoSizeValue, VideoSettingsPanel } from "./video-settings-panel";

test("video settings use the selected video model instead of the stale global model", () => {
    const imageChannel = createModelChannel({ id: "image", baseUrl: "https://api.example.com/v1", models: [{ name: "gpt-image-2", capability: "image" }] });
    const videoChannel = createModelChannel({ id: "video", baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3", models: [{ name: "doubao-seedance-2-0-pro", capability: "video" }] });
    const selectedModel = encodeChannelModel(videoChannel.id, "doubao-seedance-2-0-pro");
    const config = {
        ...defaultConfig,
        channels: [imageChannel, videoChannel],
        model: encodeChannelModel(imageChannel.id, "gpt-image-2"),
        videoModel: selectedModel,
    };

    const html = renderToStaticMarkup(
        createElement(VideoSettingsPanel, {
            config,
            selectedModel,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof VideoSettingsPanel>[0]),
    );

    assert.match(html, /生成声音/);
    assert.match(html, /水印/);
});

test("generic video dimension controls display the dimensions sent to the provider", async () => {
    const post = spyOn(axios, "post").mockResolvedValue({ data: { id: "fixture" } });
    const channel = createModelChannel({ id: "fixture", baseUrl: "https://provider.invalid", apiKey: "fixture-only", models: [{ name: "vendor-video", capability: "video" }] });
    const selectedModel = encodeChannelModel(channel.id, "vendor-video");
    try {
        for (const [size, vquality] of [["1:1", "720"], ["9:16", "1080"], ["4:3", "480"], ["1280x720", "1080"]]) {
            const config = { ...defaultConfig, channels: [channel], model: selectedModel, videoModel: selectedModel, size, vquality };
            await createVideoGenerationTask(config, "fixture");
            const pixels = (post.mock.calls.at(-1)![1] as FormData).get("size") as string;
            assert.equal(normalizeVideoSizeValue(size, vquality), pixels);
            const html = renderToStaticMarkup(createElement(VideoSettingsPanel, { config, selectedModel, onConfigChange: () => undefined, theme: canvasThemes.light }));
            const [width, height] = pixels.split("x");
            assert.match(html, new RegExp(`>W</span><input[^>]*value="${width}"`));
            assert.match(html, new RegExp(`>H</span><input[^>]*value="${height}"`));
        }
    } finally {
        post.mockRestore();
    }
});

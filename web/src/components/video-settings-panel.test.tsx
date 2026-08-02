import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { VideoSettingsPanel } from "./video-settings-panel";

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

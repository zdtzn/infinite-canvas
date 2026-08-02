import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { createModelChannel, defaultConfig, encodeChannelModel, modelOptionsFromChannels } from "@/stores/use-config-store";
import { ImageSettingsPanel } from "./image-settings-panel";

test("image settings use the workbench-selected channel instead of a stale global model", () => {
    const uuChannel = createModelChannel({
        id: "uu",
        name: "UU",
        baseUrl: "https://uuapi.net/v1",
        models: [{ name: "gpt-image-2", capability: "image" }],
    });
    const standardChannel = createModelChannel({
        id: "standard",
        name: "Standard",
        baseUrl: "https://api.example.com/v1",
        models: [{ name: "gpt-image-2", capability: "image" }],
    });
    const channels = [uuChannel, standardChannel];
    const config = {
        ...defaultConfig,
        channels,
        models: modelOptionsFromChannels(channels),
        model: encodeChannelModel(uuChannel.id, "gpt-image-2"),
        imageModel: encodeChannelModel(standardChannel.id, "gpt-image-2"),
    };

    const html = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config,
            selectedModel: config.imageModel,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof ImageSettingsPanel>[0]),
    );

    assert.doesNotMatch(html, /当前异步渠道由模型自动控制/);
    assert.match(html, />高<\/button>/);
});

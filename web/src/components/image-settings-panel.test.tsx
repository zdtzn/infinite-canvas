import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { createModelChannel, defaultConfig, encodeChannelModel, modelOptionsFromChannels } from "@/stores/use-config-store";
import { ImageSettingsPanel, imageAspectOptions, imageSizeLabel } from "./image-settings-panel";

test("image aspect presets no longer expose an automatic ratio", () => {
    assert.equal(imageAspectOptions.some((option) => option.value === "auto"), false);
    assert.equal(imageAspectOptions.find((option) => option.value === "1:1")?.label, "方图 (1:1)");
    assert.equal(imageSizeLabel("21:9"), "电影宽屏 21:9");
});

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

test("image settings expose only parameters the selected provider can honor", () => {
    const geminiChannel = createModelChannel({
        id: "gemini",
        apiFormat: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        models: [{ name: "gemini-2.5-flash-image", capability: "image" }],
    });
    const geminiModel = encodeChannelModel(geminiChannel.id, "gemini-2.5-flash-image");
    const geminiHtml = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: { ...defaultConfig, channels: [geminiChannel], model: geminiModel, imageModel: geminiModel, quality: "high", count: "10" },
            selectedModel: geminiModel,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof ImageSettingsPanel>[0]),
    );
    assert.match(geminiHtml, /当前模型由上游自动决定输出分辨率/);
    assert.match(geminiHtml, /max="4"/);
    assert.doesNotMatch(geminiHtml, />4K<\/button>/);
    assert.match(geminiHtml, />1:8<\/span>/);
    assert.match(geminiHtml, />21:9<\/span>/);
    assert.doesNotMatch(geminiHtml, />9:21<\/span>/);

    const uuChannel = createModelChannel({ id: "uu", baseUrl: "https://uuapi.net/v1", models: [{ name: "gpt-image-2", capability: "image" }] });
    const uuModel = encodeChannelModel(uuChannel.id, "gpt-image-2");
    const uuHtml = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: { ...defaultConfig, channels: [uuChannel], model: uuModel, imageModel: uuModel, quality: "high", size: "3840x3840" },
            selectedModel: uuModel,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof ImageSettingsPanel>[0]),
    );
    assert.match(uuHtml, /当前 UU 渠道由模型自动控制/);
    assert.match(uuHtml, />4K<\/button>/);
    assert.doesNotMatch(uuHtml, /16倍数对齐/);

    const sadaiChannel = createModelChannel({ id: "sadai", baseUrl: "https://api.sadai.top/v1", models: [{ name: "gpt-image-2", capability: "image" }] });
    const sadaiModel = encodeChannelModel(sadaiChannel.id, "gpt-image-2");
    const sadaiHtml = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: { ...defaultConfig, channels: [sadaiChannel], model: sadaiModel, imageModel: sadaiModel, size: "2:3" },
            selectedModel: sadaiModel,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof ImageSettingsPanel>[0]),
    );
    assert.match(sadaiHtml, />2:3<\/span>/);
    assert.match(sadaiHtml, />3:2<\/span>/);
    assert.match(sadaiHtml, />3:4<\/span>/);
    assert.match(sadaiHtml, /默认分组可能由上游决定/);
});

test("GPT Image 2 settings show flexible ratios and their constrained request dimensions", () => {
    const channel = createModelChannel({ id: "tokenai", baseUrl: "https://tken.me", models: [{ name: "gpt-image-2", capability: "image" }] });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const html = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: { ...defaultConfig, channels: [channel], model, imageModel: model, quality: "low", size: "16:9" },
            selectedModel: model,
            onConfigChange: () => undefined,
            theme: canvasThemes.light,
            showTitle: false,
        } as Parameters<typeof ImageSettingsPanel>[0]),
    );

    assert.match(html, />5:4<\/span>/);
    assert.match(html, />3:1<\/span>/);
    assert.match(html, />经典方幅<\/span>/);
    assert.match(html, />超宽横幅<\/span>/);
    assert.match(html, /value="1280"/);
    assert.match(html, /value="720"/);
    assert.doesNotMatch(html, />1:4<\/span>/);
});

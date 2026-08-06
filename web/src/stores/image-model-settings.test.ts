import { describe, expect, test } from "bun:test";

import { createModelChannel, defaultConfig, encodeChannelModel } from "./use-config-store";
import { resolveImageModelSettings } from "./image-model-settings";

describe("resolved image model settings", () => {
    test("clears hidden incompatible settings when switching to a Gemini model", () => {
        const channel = createModelChannel({
            id: "gemini",
            apiFormat: "gemini",
            baseUrl: "https://generativelanguage.googleapis.com",
            models: [{ name: "gemini-2.5-flash-image", capability: "image" }],
        });
        const model = encodeChannelModel(channel.id, "gemini-2.5-flash-image");
        const resolved = resolveImageModelSettings(
            {
                ...defaultConfig,
                channels: [channel],
                model,
                imageModel: model,
                quality: "high",
                imageQuality: "high",
                size: "1408x1056",
                background: "transparent",
                count: "10",
            },
            model,
            10,
        );

        expect(resolved.config.quality).toBe("auto");
        expect(resolved.config.imageQuality).toBe("auto");
        expect(resolved.config.size).toBe("4:3");
        expect(resolved.config.background).toBe("");
        expect(resolved.config.count).toBe("4");
    });

    test("uses channel-specific SADAI and UU restrictions", () => {
        const sadai = createModelChannel({
            id: "sadai",
            baseUrl: "https://api.sadai.top/v1",
            models: [{ name: "gpt-image-2", capability: "image" }],
        });
        const uu = createModelChannel({
            id: "uu",
            baseUrl: "https://uuapi.net/v1",
            models: [{ name: "gpt-image-2", capability: "image" }],
        });
        const sadaiModel = encodeChannelModel(sadai.id, "gpt-image-2");
        const uuModel = encodeChannelModel(uu.id, "gpt-image-2");

        const sadaiSettings = resolveImageModelSettings({ ...defaultConfig, channels: [sadai], model: sadaiModel, imageModel: sadaiModel, size: "2048x1152", background: "transparent" }, sadaiModel);
        expect(sadaiSettings.capabilities.customSize).toBe(false);
        expect(sadaiSettings.config.size).toBe("16:9");
        expect(sadaiSettings.config.background).toBe("");

        const supportedSadaiRatio = resolveImageModelSettings({ ...defaultConfig, channels: [sadai], model: sadaiModel, imageModel: sadaiModel, size: "2:3" }, sadaiModel);
        expect(supportedSadaiRatio.config.size).toBe("2:3");
        expect(supportedSadaiRatio.capabilities.maxReferences).toBe(6);

        const uuSettings = resolveImageModelSettings({ ...defaultConfig, channels: [uu], model: uuModel, imageModel: uuModel, quality: "high", imageQuality: "high", imageOutputFormat: "webp" }, uuModel);
        expect(uuSettings.capabilities.resolutions).toEqual(["low", "medium", "high"]);
        expect(uuSettings.config.quality).toBe("high");
        expect(uuSettings.config.imageQuality).toBe("auto");
        expect(uuSettings.config.imageOutputFormat).toBe("auto");
    });

    test("uses conservative defaults for newly configured unknown image models", () => {
        const channel = createModelChannel({
            id: "vendor",
            baseUrl: "https://api.vendor.example",
            models: [{ name: "vendor-image-v1", capability: "image", imageCapabilities: { mode: "auto" } }],
        });
        const model = encodeChannelModel(channel.id, "vendor-image-v1");
        const resolved = resolveImageModelSettings({ ...defaultConfig, channels: [channel], model, imageModel: model, quality: "high", imageQuality: "high", imageOutputFormat: "webp", size: "16:9", count: "4" }, model);

        expect(resolved.config.quality).toBe("auto");
        expect(resolved.config.imageQuality).toBe("auto");
        expect(resolved.config.imageOutputFormat).toBe("auto");
        expect(resolved.config.size).toBe("1:1");
        expect(resolved.config.count).toBe("1");
    });
});

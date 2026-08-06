import { describe, expect, test } from "bun:test";

import { applyPlatformChannels, createModelChannel, defaultConfig, encodeChannelModel, normalizeChannelModels, normalizeImageSizeSelection, resolveModelForCapability, resolveModelRequestConfig, useConfigStore } from "./use-config-store";

test("legacy automatic image ratios migrate to an explicit square ratio", () => {
    expect(normalizeImageSizeSelection("auto")).toBe("1:1");
    expect(normalizeImageSizeSelection("")).toBe("1:1");
    expect(normalizeImageSizeSelection("16:9")).toBe("16:9");
});

describe("platform channel hydration", () => {
    test("preserves a valid selected model and never keeps a browser API key", () => {
        const first = createModelChannel({
            id: "first",
            name: "First",
            baseUrl: "https://first.example.com",
            apiKey: "must-not-survive",
            models: [{ name: "image-a", capability: "image" }],
        });
        const second = createModelChannel({
            id: "second",
            name: "Second",
            baseUrl: "https://second.example.com",
            models: [{ name: "image-b", capability: "image" }],
        });
        const selected = encodeChannelModel(second.id, "image-b");

        const config = applyPlatformChannels({ ...defaultConfig, imageModel: selected }, [first, second]);

        expect(config.imageModel).toBe(selected);
        expect(config.channels.every((channel) => channel.apiKey === "" && channel.credentialState === "saved")).toBe(true);
    });

    test("falls back by capability and supports no configured platform channels", () => {
        const channel = createModelChannel({
            id: "shared",
            models: [
                { name: "image-new", capability: "image" },
                { name: "text-new", capability: "text" },
            ],
        });

        const hydrated = applyPlatformChannels(defaultConfig, [channel]);
        expect(hydrated.imageModel).toBe(encodeChannelModel("shared", "image-new"));
        expect(hydrated.textModel).toBe(encodeChannelModel("shared", "text-new"));
        expect(hydrated.videoModel).toBe("");

        const empty = applyPlatformChannels(hydrated, []);
        expect(empty.channels).toEqual([]);
        expect(empty.models).toEqual([]);
        expect(empty.imageModel).toBe("");
    });

    test("preserves the configured platform channel order for model pickers", () => {
        const first = createModelChannel({ id: "first", sortOrder: 0, models: [{ name: "image-first", capability: "image" }] });
        const later = createModelChannel({ id: "later", sortOrder: 1, models: [{ name: "image-later", capability: "image" }] });

        const config = applyPlatformChannels(defaultConfig, [later, first]);

        expect(config.channels.map((channel) => [channel.id, channel.sortOrder])).toEqual([
            ["later", 1],
            ["first", 0],
        ]);
        expect(config.models).toEqual([encodeChannelModel("later", "image-later"), encodeChannelModel("first", "image-first")]);
    });

    test("keeps text reasoning automatic by default and rejects a model from another capability", () => {
        const channel = createModelChannel({
            id: "shared",
            models: [
                { name: "image-model", capability: "image" },
                { name: "text-model", capability: "text" },
            ],
        });
        const config = applyPlatformChannels(defaultConfig, [channel]);

        expect(config.reasoningEffort).toBe("auto");
        expect(resolveModelForCapability(config, encodeChannelModel("shared", "image-model"), "text")).toBe(encodeChannelModel("shared", "text-model"));
    });

    test("preserves image capability metadata through hydration and request resolution", () => {
        const imageCapabilities = { mode: "custom" as const, sizes: ["1:1", "16:9"], resolutions: ["low"], maxOutputs: 2, maxReferences: 1 };
        const channel = createModelChannel({ id: "custom", models: [{ name: "vendor-image", capability: "image", imageCapabilities }] });
        const config = applyPlatformChannels(defaultConfig, [channel]);
        const selected = encodeChannelModel("custom", "vendor-image");

        expect(config.channels[0]?.models[0]?.imageCapabilities).toMatchObject(imageCapabilities);
        expect(resolveModelRequestConfig(config, selected).imageCapabilities).toMatchObject(imageCapabilities);
        expect(normalizeChannelModels([{ name: "vendor-image", capability: "text", imageCapabilities }])).toEqual([{ name: "vendor-image", capability: "text", script: undefined, imageCapabilities: undefined }]);
    });
});

describe("sensitive browser configuration", () => {
    test("clears every in-memory credential when the account session changes", () => {
        useConfigStore.setState((state) => ({
            config: {
                ...state.config,
                apiKey: "legacy-browser-key",
                channels: [createModelChannel({ id: "private", apiKey: "provider-key" })],
            },
            webdav: { ...state.webdav, password: "plain-text-secret" },
        }));

        useConfigStore.getState().clearSensitiveSession();

        const state = useConfigStore.getState();
        expect(state.webdav.password).toBe("");
        expect(state.config.apiKey).toBe("");
        expect(state.config.channels[0]?.apiKey).toBe("");
    });
});

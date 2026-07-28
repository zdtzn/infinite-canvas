import { describe, expect, test } from "bun:test";

import { applyPlatformChannels, createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "./use-config-store";

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

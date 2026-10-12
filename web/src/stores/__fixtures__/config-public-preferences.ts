import assert from "node:assert/strict";

Object.defineProperty(globalThis, "window", { value: { __RUNTIME_CONFIG__: { PUBLIC_MODE: true } } });
const { applyGenerationPreferences, applyPlatformChannels, createModelChannel, defaultConfig, defaultGenerationPreferences, encodeChannelModel, generationPreferencesFromConfig, useConfigStore } = await import("../use-config-store");
const channel = createModelChannel({
    id: "platform",
    models: [
        { name: "image-new", capability: "image" },
        { name: "video-new", capability: "video" },
        { name: "audio-new", capability: "audio" },
    ],
});

assert.equal(defaultGenerationPreferences.imageModel, "");
assert.equal(defaultGenerationPreferences.videoModel, "");
assert.equal(defaultGenerationPreferences.audioModel, "");

for (const config of [applyPlatformChannels(applyGenerationPreferences(defaultConfig, defaultGenerationPreferences), [channel]), applyGenerationPreferences(applyPlatformChannels(defaultConfig, [channel]), defaultGenerationPreferences)]) {
    assert.equal(config.imageModel, encodeChannelModel("platform", "image-new"));
    assert.equal(config.videoModel, encodeChannelModel("platform", "video-new"));
    assert.equal(config.audioModel, encodeChannelModel("platform", "audio-new"));
    assert.equal(useConfigStore.getState().isAiConfigReady(config, config.imageModel), true);
    const removed = applyPlatformChannels(config, []);
    assert.equal(removed.imageModel, config.imageModel);
    assert.equal(useConfigStore.getState().isAiConfigReady(removed, removed.imageModel), false);
    assert.equal(applyGenerationPreferences(config, { ...defaultGenerationPreferences, imageModel: "missing::image" }).imageModel, "missing::image");
    assert.equal(generationPreferencesFromConfig(config, true).imageModel, config.imageModel);
}
console.log("public preference initialization passed");

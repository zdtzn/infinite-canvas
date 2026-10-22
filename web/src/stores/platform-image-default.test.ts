import { afterEach, expect, test } from "bun:test";
import { createModelChannel, defaultConfig, defaultGenerationPreferences, generationPreferencesFromConfig, useConfigStore } from "./use-config-store";

const original = useConfigStore.getState();
afterEach(() => useConfigStore.setState(original));

const first = { channelId: "shared", model: "image-a", revision: 1 };
const second = { channelId: "shared", model: "image-b", revision: 2 };
const channels = [createModelChannel({ id: "shared", models: [{ name: "image-a", capability: "image" }, { name: "image-b", capability: "image" }] })];

test("new platform defaults apply once, allowing later personal selections to survive refresh", () => {
    const store = useConfigStore.getState();
    useConfigStore.setState({ config: defaultConfig, platformImageDefault: null });
    store.setPlatformChannels(channels);
    store.setPlatformImageDefault(first);
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-a");
    store.updateConfig("imageModel", "shared::image-b");
    store.setPlatformImageDefault(first);
    store.setPlatformChannels(channels);
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-b");
    store.updateConfig("imageModel", "shared::image-a");
    store.setPlatformImageDefault(second);
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-b");
    expect(useConfigStore.getState().config.imageModelDefaultRevision).toBe(2);
    store.updateConfig("imageModel", "shared::image-b");
    store.setPlatformImageDefault({ ...first, revision: 3 });
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-a");
    expect(useConfigStore.getState().config.model).toBe("shared::image-a");
});

test("old personal preferences cannot undo a newly received default in either loading order", () => {
    for (const defaultsFirst of [true, false]) {
        useConfigStore.setState({ config: defaultConfig, platformImageDefault: null });
        const store = useConfigStore.getState();
        const old = { ...defaultGenerationPreferences, imageModel: "shared::image-b", count: "7" };
        if (defaultsFirst) store.setPlatformImageDefault(first);
        store.replaceGenerationPreferences(old);
        if (!defaultsFirst) store.setPlatformImageDefault(first);
        store.setPlatformChannels(channels);
        const config = useConfigStore.getState().config;
        expect(config.imageModel).toBe("shared::image-a");
        expect(config.count).toBe("7");
        expect(generationPreferencesFromConfig(config, true).imageModelDefaultRevision).toBe(1);
        expect(useConfigStore.getState().generationPreferencesRevision).toBe(original.generationPreferencesRevision);
    }
});

test("saved personal selections for the current revision survive reload; stale shared responses cannot roll back", () => {
    useConfigStore.setState({ config: defaultConfig, platformImageDefault: null });
    const store = useConfigStore.getState();
    store.setPlatformImageDefault(second);
    store.replaceGenerationPreferences({ ...defaultGenerationPreferences, imageModel: "shared::image-a", imageModelDefaultRevision: 2 });
    store.setPlatformImageDefault(first);
    expect(useConfigStore.getState().platformImageDefault).toEqual(second);
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-a");
    store.setPlatformImageDefault(null);
    expect(useConfigStore.getState().config.imageModel).toBe("shared::image-a");
});

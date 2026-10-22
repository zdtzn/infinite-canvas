import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as react from "react";

const scenario = process.argv[2];
const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: {
    __RUNTIME_CONFIG__: { PUBLIC_MODE: true },
    localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) },
    location: { search: "" }, addEventListener() {}, removeEventListener() {},
} });
const store = await import("@/stores/use-config-store");
store.useConfigStore.setState({ config: store.defaultConfig, snapDimensionToStep: true });
const initial = store.useConfigStore.getState();
const cloud = { ...store.defaultGenerationPreferences, imageModel: "platform::preferred", count: "7", quality: "high" };
const channel = { ...store.createModelChannel({ id: "platform", baseUrl: "https://provider.invalid", models: [{ name: "first", capability: "image" }, { name: "preferred", capability: "image" }] }), hasApiKey: true };
const user = { id: "fixture-user", admin: false };
const saves: Array<Record<string, any>> = [];
const errors: unknown[] = [];
const effects: Array<() => unknown> = [];
const message = { error: (error: unknown) => errors.push(error), success() {} };
let finishPreferences!: (value: unknown) => void;
let finishChannels!: (value: unknown) => void;
const preferences = new Promise((resolve) => { finishPreferences = resolve; });
const channels = new Promise((resolve) => { finishChannels = resolve; });
const noop = () => undefined;
const configHook = Object.assign((select: (value: typeof initial) => unknown) => select(store.useConfigStore.getState()), { getState: store.useConfigStore.getState });
mock.module("@/stores/use-config-store", () => ({ ...store, useConfigStore: configHook }));
mock.module("react", () => ({ ...react, useEffect: (effect: () => unknown) => effects.push(effect), useLayoutEffect: (effect: () => unknown) => effects.push(effect), useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, noop] }));
mock.module("antd", () => ({ App: { useApp: () => ({ message }) } }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: Object.assign((select: (value: unknown) => unknown) => select({ user }), { getState: () => ({ user }) }) }));
mock.module("@/stores/use-asset-store", () => ({ useAssetStore: Object.assign((select: (value: unknown) => unknown) => select({ hydrated: false, prepareForUser: noop, hydrateFromServer: noop }), { getState: () => ({ flushAssetSync: noop }) }) }));
mock.module("@/stores/use-prompt-source-store", () => ({ isBuiltInPromptSource: noop, usePromptSourceStore: (select: (value: unknown) => unknown) => select({ sources: [], hydrated: false, setSharedSources: noop }) }));
mock.module("@/hooks/use-project-server-sync", () => ({ useProjectServerSync: noop }));
mock.module("@/hooks/use-prompt-source-scheduler", () => ({ usePromptSourceScheduler: noop }));
mock.module("@/hooks/use-platform-model-defaults", () => ({ usePlatformModelDefaults: noop }));
mock.module("@/services/api/prompts", () => ({ ensurePromptIndexReady: noop }));
mock.module("@/services/server-api", () => ({
    fetchServerChannels: () => channels, fetchServerUserPreferences: () => preferences,
    fetchServerPromptSources: noop, saveServerChannel: noop, saveServerPromptSource: noop,
    saveServerUserPreferences: async (body: Record<string, any>) => { saves.push(body); return { systemPrompt: "", generationPreferences: body.generationPreferences || cloud }; },
}));
const { ClientRootInit } = await import("../client-root-init");
ClientRootInit();
effects.forEach((effect) => effect());
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
if (scenario !== "preferences-first") {
    finishChannels({ items: [channel] });
    await flush();
}
if (scenario === "edited") store.useConfigStore.getState().updateConfig("count", "4");
if (scenario === "snap-edited") store.useConfigStore.getState().setSnapDimensionToStep(false);
finishPreferences({ systemPrompt: "", systemPromptConfigured: true, generationPreferencesConfigured: true, generationPreferences: cloud });
await flush();
if (scenario === "preferences-first") {
    finishChannels({ items: [channel] });
    await flush();
}
assert.deepEqual(errors, []);
const config = store.useConfigStore.getState().config;
if (scenario === "edited" || scenario === "snap-edited") {
    assert.equal(saves.length, 1);
    assert.equal(saves[0].generationPreferences.count, scenario === "edited" ? "4" : "1");
    assert.equal(saves[0].generationPreferences.snapDimensionToStep, scenario !== "snap-edited");
} else {
    assert.equal(config.imageModel, cloud.imageModel);
    assert.equal(config.count, cloud.count);
    assert.equal(config.quality, cloud.quality);
    assert.equal(saves.length, 0);
}
console.log(`${scenario}: preference sync passed`);

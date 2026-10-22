import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as react from "react";

const scenario = process.argv[2];
const windowEvents = new Map<string, () => void>();
const documentEvents = new Map<string, () => void>();
const intervals = new Map<number, () => void>();
const fakeDocument = { visibilityState: "visible", addEventListener: (name: string, callback: () => void) => documentEvents.set(name, callback), removeEventListener: (name: string) => documentEvents.delete(name) };
const fakeNavigator = { onLine: true };
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.defineProperty(globalThis, "window", { value: {
    __RUNTIME_CONFIG__: { PUBLIC_MODE: true }, localStorage: storage,
    addEventListener: (name: string, callback: () => void) => windowEvents.set(name, callback), removeEventListener: (name: string) => windowEvents.delete(name),
    setInterval: (callback: () => void, delay: number) => { assert.equal(delay, 15_000); intervals.set(1, callback); return 1; }, clearInterval: (id: number) => intervals.delete(id),
} });
Object.defineProperty(globalThis, "localStorage", { value: storage });
Object.defineProperty(globalThis, "document", { value: fakeDocument });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakeNavigator });

const { createModelChannel, defaultConfig, useConfigStore } = await import("@/stores/use-config-store");
type ImageDefault = import("@/stores/use-config-store").PlatformImageDefault;
const first = { channelId: "shared", model: "image-a", revision: 1 };
const newer = { channelId: "shared", model: "image-c", revision: 2 };
const channel = createModelChannel({ id: "shared", models: ["image-a", "image-b", "image-c"].map((name) => ({ name, capability: "image" as const })) });
useConfigStore.setState({ config: defaultConfig, platformImageDefault: null, platformImageDefaultLoaded: false });
useConfigStore.getState().setPlatformChannels([channel]);
let user: { id: string } | undefined = { id: "user-a" };
const effects: Array<() => (() => void) | undefined> = [];
const errors: unknown[] = [];
const pending: Array<{ userId: string; resolve: (value: { image: ImageDefault | null }) => void }> = [];
let channelReads = 0;
mock.module("react", () => ({ ...react, useEffect: (effect: () => (() => void) | undefined) => effects.push(effect) }));
mock.module("antd", () => ({ App: { useApp: () => ({ message: { error: (error: unknown) => errors.push(error) } }) } }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: Object.assign((select: (state: { user: typeof user }) => unknown) => select({ user }), { getState: () => ({ user }) }) }));
mock.module("@/services/server-api", () => ({
    fetchServerModelDefaults: (userId: string) => new Promise<{ image: ImageDefault | null }>((resolve) => pending.push({ userId, resolve })),
    fetchServerChannels: async () => { channelReads++; return { items: [{ ...channel, hasApiKey: true }] }; },
}));
const { usePlatformModelDefaults } = await import("../use-platform-model-defaults");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const mount = () => { usePlatformModelDefaults(); return effects.pop()!()!; };
const focus = () => windowEvents.get("focus")!();
const poll = () => intervals.get(1)!();
const answer = async (index: number, image: ImageDefault | null) => { pending[index].resolve({ image }); await flush(); };
const currentModel = () => useConfigStore.getState().config.imageModel;
const assertClean = () => { assert.equal(intervals.size, 0); assert.equal(windowEvents.size, 0); assert.equal(documentEvents.size, 0); };

if (scenario === "refresh") {
    const cleanup = mount();
    assert.equal(pending[0].userId, "user-a");
    focus();
    assert.equal(pending.length, 1, "overlapping focus does not duplicate an in-flight read");
    await answer(0, first);
    assert.equal(currentModel(), "shared::image-a");
    useConfigStore.getState().updateConfig("imageModel", "shared::image-b");
    focus(); await answer(1, first);
    assert.equal(currentModel(), "shared::image-b", "same revision preserves the member's later selection");
    poll(); await answer(2, newer);
    assert.equal(currentModel(), "shared::image-c");
    useConfigStore.getState().updateConfig("imageModel", "shared::image-b");
    poll(); await answer(3, newer);
    assert.equal(currentModel(), "shared::image-b");
    assert.equal(channelReads, 0, "unchanged known models do not reload all channels");
    cleanup(); assertClean();
} else if (scenario === "stale-read") {
    const cleanup = mount();
    useConfigStore.getState().setPlatformImageDefault(newer);
    await answer(0, null);
    assert.deepEqual(useConfigStore.getState().platformImageDefault, newer);
    focus();
    useConfigStore.getState().setPlatformImageDefault({ ...first, revision: 3 });
    await answer(1, newer);
    assert.equal(useConfigStore.getState().platformImageDefault?.revision, 3);
    assert.equal(currentModel(), "shared::image-a");
    cleanup(); assertClean();
} else if (scenario === "lifetime") {
    const cleanup = mount();
    user = { id: "user-b" };
    await answer(0, first);
    assert.equal(useConfigStore.getState().platformImageDefault, null, "the old account's response is ignored");
    cleanup(); assertClean();
    const cleanupNext = mount();
    assert.equal(pending[1].userId, "user-b");
    cleanupNext();
    await answer(1, newer);
    assert.equal(useConfigStore.getState().platformImageDefault, null, "unmounted hooks cannot apply a late response");
    assertClean();
} else if (scenario === "suspended") {
    fakeDocument.visibilityState = "hidden";
    const cleanup = mount();
    poll(); focus();
    assert.equal(pending.length, 0);
    fakeDocument.visibilityState = "visible";
    fakeNavigator.onLine = false;
    documentEvents.get("visibilitychange")!(); poll();
    assert.equal(pending.length, 0);
    fakeNavigator.onLine = true;
    windowEvents.get("online")!();
    assert.equal(pending.length, 1);
    await answer(0, first);
    assert.equal(currentModel(), "shared::image-a");
    cleanup(); assertClean();
} else throw new Error(`Unknown scenario: ${scenario}`);
assert.deepEqual(errors, []);
console.log(`${scenario}: model default synchronization passed`);

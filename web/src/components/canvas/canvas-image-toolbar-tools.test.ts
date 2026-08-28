import { describe, expect, test } from "bun:test";

import { IMAGE_QUICK_TOOLS_VERSION, imageQuickToolsStorageKey, loadImageQuickToolsConfig, writeImageQuickToolsConfig, type ImageQuickToolsConfig } from "./canvas-image-toolbar-tools";

function createStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        value: (key: string) => values.get(key) ?? null,
    };
}

describe("canvas image toolbar preferences", () => {
    test("keeps toolbar choices isolated by account", () => {
        const storage = createStorage();
        const alice: ImageQuickToolsConfig = { ids: ["saveAsset", "download", "split"], showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION };
        const bob: ImageQuickToolsConfig = { ids: ["info", "download", "crop"], showLabels: true, version: IMAGE_QUICK_TOOLS_VERSION };

        writeImageQuickToolsConfig(storage, "alice", alice);
        writeImageQuickToolsConfig(storage, "bob", bob);

        expect(loadImageQuickToolsConfig(storage, "alice")).toEqual({ config: alice, configured: true });
        expect(loadImageQuickToolsConfig(storage, "bob")).toEqual({ config: bob, configured: true });
    });

    test("migrates the latest legacy browser preference without losing split", () => {
        const legacy = { ids: ["download", "edit", "split", "view"], showLabels: false };
        const storage = createStorage({ "canvas-image-quick-tools-v7": JSON.stringify(legacy) });
        const migrated = { ids: ["download", "edit", "split", "lighting", "view"], showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION };

        expect(loadImageQuickToolsConfig(storage, "alice")).toEqual({ config: migrated, configured: true });
        expect(storage.value(imageQuickToolsStorageKey("alice"))).toBe(JSON.stringify(migrated));
        expect(storage.value("canvas-image-quick-tools-v7")).toBeNull();
    });

    test("waits for the signed-in account before consuming a legacy preference", () => {
        const legacy = { ids: ["download", "split"], showLabels: false };
        const storage = createStorage({ "canvas-image-quick-tools-v7": JSON.stringify(legacy) });

        const migrated = { ids: ["download", "split", "lighting"], showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION };
        expect(loadImageQuickToolsConfig(storage, "")).toEqual({ config: migrated, configured: true });
        expect(storage.value("canvas-image-quick-tools-v7")).toBe(JSON.stringify(legacy));
        expect(storage.value(imageQuickToolsStorageKey(""))).toBeNull();

        expect(loadImageQuickToolsConfig(storage, "alice")).toEqual({ config: migrated, configured: true });
        expect(storage.value(imageQuickToolsStorageKey("alice"))).toBe(JSON.stringify(migrated));
        expect(storage.value("canvas-image-quick-tools-v7")).toBeNull();
    });

    test("falls back safely when browser storage is unavailable", () => {
        const storage = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
            removeItem: () => {
                throw new Error("blocked");
            },
        };

        expect(loadImageQuickToolsConfig(storage, "alice").configured).toBeFalse();
        expect(() => writeImageQuickToolsConfig(storage, "alice", { ids: ["split"], showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION })).not.toThrow();
    });
});

import { afterEach, expect, test } from "bun:test";

import { readLocalStorageUsage } from "./local-storage-usage";

const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
    if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    else Reflect.deleteProperty(globalThis, "indexedDB");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
});

function installDatabase() {
    const transactions: { names: string[]; mode: string }[] = [];
    let closed = false;
    const values = [new Blob([new Uint8Array(1024)]), "画布"];
    const database = {
        objectStoreNames: ["image_files"],
        version: 3,
        close: () => { closed = true; },
        transaction: (names: string[], mode: string) => {
            transactions.push({ names, mode });
            return {
                objectStore: (name: string) => ({
                    name,
                    openCursor: () => {
                        let index = 0;
                        const request = { result: null as unknown, onsuccess: null as (() => void) | null };
                        const advance = () => queueMicrotask(() => {
                            request.result = index < values.length ? { value: values[index++], continue: advance } : null;
                            request.onsuccess?.();
                        });
                        advance();
                        return request;
                    },
                }),
            };
        },
    };
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
        open: () => {
            const request = { result: database, onsuccess: null as (() => void) | null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    } });
    return { transactions, isClosed: () => closed };
}

test("storage estimate failure keeps database diagnostics and an unknown quota", async () => {
    const database = installDatabase();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => { throw new Error("estimate blocked"); } } } });

    const usage = await readLocalStorageUsage();

    expect(usage).toMatchObject({ usage: 1030, quota: null, contentBytes: 1030 });
    expect(usage.databases[0].stores).toEqual([{ name: "image_files", records: 2, bytes: 1030 }]);
    expect(database.transactions).toEqual([{ names: ["image_files"], mode: "readonly" }]);
    expect(database.isClosed()).toBe(true);
});

test("missing storage estimate API falls back to database content size", async () => {
    installDatabase();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });

    expect(await readLocalStorageUsage()).toMatchObject({ usage: 1030, quota: null });
});

test("missing usage and quota fields fall back independently while zero usage is preserved", async () => {
    installDatabase();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ quota: 4096 }) } } });
    expect(await readLocalStorageUsage()).toMatchObject({ usage: 1030, quota: 4096 });

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ usage: 0 }) } } });
    expect(await readLocalStorageUsage()).toMatchObject({ usage: 0, quota: null });
});

test("database errors still reject when storage estimates are unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
        open: () => {
            const request = { error: new Error("数据库不可用"), onerror: null as (() => void) | null };
            queueMicrotask(() => request.onerror?.());
            return request;
        },
    } });

    await expect(readLocalStorageUsage()).rejects.toThrow("数据库不可用");
});

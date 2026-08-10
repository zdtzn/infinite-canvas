import assert from "node:assert/strict";
import { test } from "node:test";

import { localForageStorage } from "./localforage-storage";

test("tolerates a browser-like environment without localStorage", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

    try {
        assert.equal(await localForageStorage.getItem("missing"), null);
        await assert.doesNotReject(() => Promise.resolve(localForageStorage.setItem("key", "value")));
        await assert.doesNotReject(() => Promise.resolve(localForageStorage.removeItem("key")));
    } finally {
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

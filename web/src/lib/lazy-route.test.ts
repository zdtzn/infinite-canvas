import { describe, expect, test } from "bun:test";

import { isChunkLoadError } from "./lazy-route";

describe("lazy route recovery", () => {
    test("recognizes stale deployment chunk failures", () => {
        expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/page-old.js"))).toBe(true);
        expect(isChunkLoadError(new Error("Loading chunk project failed"))).toBe(true);
    });

    test("does not reload for ordinary application errors", () => {
        expect(isChunkLoadError(new Error("crypto.randomUUID is not a function"))).toBe(false);
        expect(isChunkLoadError(new Error("Invalid request"))).toBe(false);
    });
});

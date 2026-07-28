import { describe, expect, test } from "bun:test";

import { parseSingleByteRange } from "./http-range";

describe("single HTTP byte ranges", () => {
    test("supports bounded, open-ended, and suffix ranges", () => {
        expect(parseSingleByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
        expect(parseSingleByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
        expect(parseSingleByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
        expect(parseSingleByteRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
    });

    test("rejects malformed, multiple, and unsatisfiable ranges", () => {
        expect(parseSingleByteRange("bytes=20-10", 100)).toBe("invalid");
        expect(parseSingleByteRange("bytes=100-", 100)).toBe("invalid");
        expect(parseSingleByteRange("bytes=0-1,4-5", 100)).toBe("invalid");
        expect(parseSingleByteRange("items=0-1", 100)).toBe("invalid");
    });
});

import { describe, expect, test } from "bun:test";
import { assertMediaDuration, frameTime, validateTrim, readLimitedMedia, waitForMediaEvent, MEDIA_LIMITS } from "./canvas-media-tools";

describe("media boundaries", () => {
    test("rejects invalid and excessive durations", () => {
        for (const value of [0, -1, NaN, Infinity, 601]) expect(() => assertMediaDuration(value)).toThrow();
        expect(() => assertMediaDuration(600)).not.toThrow();
    });
    test("validates trim without rounding past boundaries", () => {
        expect(validateTrim({ start: 0, end: 0.5 }, 1)).toEqual({ start: 0, end: 0.5 });
        for (const range of [
            { start: -1, end: 1 },
            { start: 0, end: 0.499 },
            { start: 1, end: 1 },
            { start: 0, end: 2 },
            { start: NaN, end: 1 },
        ])
            expect(() => validateTrim(range, 1)).toThrow();
    });
    test("first/current/last stay inside duration", () => {
        expect(frameTime(2, "first", 1)).toBe(0);
        expect(frameTime(2, "last", 0)).toBeCloseTo(1.999);
        expect(frameTime(2, "current", 2)).toBeCloseTo(1.999);
        expect(() => frameTime(2, "current", -1)).toThrow();
    });
});

describe("resource lifetime", () => {
    test("rejects HTTP errors and oversized declared payloads", async () => {
        await expect(readLimitedMedia(new Response("bad", { status: 403 }), new AbortController().signal)).rejects.toThrow();
        await expect(readLimitedMedia(new Response("a", { headers: { "content-length": String(MEDIA_LIMITS.maxBytes + 1) } }), new AbortController().signal)).rejects.toThrow();
    });
    test("reads bytes and preserves MIME", async () => {
        const blob = await readLimitedMedia(new Response("abc", { headers: { "content-type": "audio/wav" } }), new AbortController().signal);
        expect(blob.size).toBe(3);
        expect(blob.type).toBe("audio/wav");
    });
    test("pre-aborted reads reject", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(readLimitedMedia(new Response("abc"), controller.signal)).rejects.toThrow();
    });
    test("event wait handles errors, cancellation, and timeout", async () => {
        const target = new EventTarget();
        const controller = new AbortController();
        const cancelled = waitForMediaEvent(target, "loadeddata", controller.signal);
        controller.abort();
        await expect(cancelled).rejects.toThrow();
        const failed = waitForMediaEvent(target, "loadeddata", new AbortController().signal);
        target.dispatchEvent(new Event("error"));
        await expect(failed).rejects.toThrow("无法读取");
        await expect(waitForMediaEvent(target, "loadeddata", new AbortController().signal, 1)).rejects.toThrow("超时");
        const loaded = waitForMediaEvent(target, "loadeddata", new AbortController().signal);
        target.dispatchEvent(new Event("loadeddata"));
        await loaded;
    });
});

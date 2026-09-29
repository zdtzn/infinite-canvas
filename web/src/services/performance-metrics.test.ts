import { expect, test } from "bun:test";
import { fetchPerformanceMetrics } from "./performance-metrics";

async function withResponse(body: unknown, status: number, run: (calls: { url: string; init?: RequestInit }[]) => Promise<void>) {
    const previousFetch = globalThis.fetch;
    const previousWindow = globalThis.window;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.window = { setTimeout, clearTimeout, dispatchEvent: () => true } as unknown as Window & typeof globalThis;
    globalThis.fetch = (async (url, init) => { calls.push({ url: String(url), init }); return Response.json(body, { status }); }) as typeof fetch;
    try { await run(calls); } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
}
const snapshot = { since: "2026-09-29T00:00:00.000Z", lifetime: "process", series: [] };

test("loads admin endpoint with shared same-origin transport and account binding", () => withResponse(snapshot, 200, async (calls) => {
    expect(await fetchPerformanceMetrics(undefined, "admin-a")).toEqual(snapshot);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/admin/performance");
    expect(calls[0].init?.credentials).toBe("same-origin");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(new Headers(calls[0].init?.headers).get("X-Expected-User-Id")).toBe("admin-a");
}));

test("permission and service failures reject once without retries", async () => {
    for (const status of [403, 500, 503]) await withResponse({ error: { message: "unavailable" } }, status, async (calls) => {
        await expect(fetchPerformanceMetrics()).rejects.toThrow();
        expect(calls).toHaveLength(1);
    });
});

test("malformed snapshots fail locally instead of reaching table rendering", async () => {
    for (const body of [null, {}, { ...snapshot, since: "bad" }, { ...snapshot, series: [null] }, { ...snapshot, series: Array(64).fill({}) },
        { ...snapshot, series: [{ route: "/image", name: "ttfb", outcome: "observed", count: 1, p50UpperMs: "wrong", p95UpperMs: 100 }] }]) {
        await withResponse(body, 200, async () => { await expect(fetchPerformanceMetrics()).rejects.toThrow("性能统计响应格式无效"); });
    }
});

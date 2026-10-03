import { expect, test } from "bun:test";
import { fetchPerformanceMetrics } from "./performance-metrics";
import { FRONTEND_PERFORMANCE_NAMES, PERFORMANCE_ROUTES, PerformanceMetrics } from "../../../server/lib/performance-metrics";

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
    for (const body of [null, {}, { ...snapshot, since: "bad" }, { ...snapshot, series: [null] }, { ...snapshot, series: Array(96).fill({}) },
        { ...snapshot, series: [{ route: "/image", name: "ttfb", outcome: "observed", count: 1, p50UpperMs: "wrong", p95UpperMs: 100 }] }]) {
        await withResponse(body, 200, async () => { await expect(fetchPerformanceMetrics()).rejects.toThrow("性能统计响应格式无效"); });
    }
});

test("accepts the complete bounded server snapshot including all new metrics and units", async () => {
    const metrics = new PerformanceMetrics();
    for (const route of PERFORMANCE_ROUTES) for (const name of FRONTEND_PERFORMANCE_NAMES) metrics.recordFrontend({ route, name, durationMs: 123 });
    for (const name of ["image_job_queue", "image_job_upstream", "image_job_persistence", "image_job_total", "image_job_outcome"] as const) {
        for (const outcome of ["succeeded", "failed", "canceled"] as const) metrics.recordImage(name, outcome, 10);
    }
    const body = metrics.snapshot();
    expect(body.series).toHaveLength(95);
    await withResponse(body, 200, async () => { expect(await fetchPerformanceMetrics()).toEqual(body); });
});

test("rejects unknown labels, wrong units, and invalid histogram buckets", async () => {
    const metrics = new PerformanceMetrics();
    metrics.recordFrontend({ route: "/image", name: "event_interaction_latency", durationMs: 160 });
    const row = metrics.snapshot().series[0];
    for (const invalid of [{ name: "inp" }, { name: "toString" }, { name: ["lcp"] }, { route: "/image?token=secret" }, { unit: "s" }, { unit: undefined },
        { buckets: null }, { buckets: Array(16).fill({ upperMs: 1, count: 1 }) }, { buckets: [{ upperMs: -1, count: 1 }] }, { buckets: [{ upperMs: 1, count: -1 }] }]) {
        await withResponse({ ...snapshot, series: [{ ...row, ...invalid }] }, 200, async () => { await expect(fetchPerformanceMetrics()).rejects.toThrow("性能统计响应格式无效"); });
    }
});

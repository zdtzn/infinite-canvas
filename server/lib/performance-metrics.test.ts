import { expect, test } from "bun:test";
import { FRONTEND_PERFORMANCE_NAMES, PERFORMANCE_ROUTES, PerformanceInputError, PerformanceMetrics, PerformanceRateLimiter, parsePerformanceSamples } from "./performance-metrics";

const encode = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));
const sample = { route: "/canvas/:id", name: "route_ready", durationMs: 125 };

test("accepts only one to three sanitized frontend samples", () => {
    expect(parsePerformanceSamples(encode({ samples: [sample, { ...sample, durationMs: 0 }, { ...sample, durationMs: 300000 }] }))).toHaveLength(3);
    for (const body of [null, [], {}, { samples: [] }, { samples: Array(4).fill(sample) }, { samples: [sample], user: "private" },
        { samples: [null] }, { samples: [{ ...sample, url: "https://private.test" }] }, { samples: [{ ...sample, durationMs: "1" }] },
        { samples: [{ ...sample, durationMs: -1 }] }, { samples: [{ ...sample, durationMs: 300001 }] }, { samples: [{ ...sample, durationMs: null }] },
        { samples: [{ ...sample, route: "/canvas/private-id" }] }, { samples: [{ ...sample, route: "/image?secret=x" }] },
        { samples: [{ ...sample, name: "image_job_total" }] }, { samples: [{ route: "/image", name: "ttfb", extra: 1 }] }]) {
        expect(() => parsePerformanceSamples(encode(body))).toThrow(PerformanceInputError);
    }
    expect(() => parsePerformanceSamples(new TextEncoder().encode('{"samples":[{"route":"/image","name":"ttfb","durationMs":1e999}]}'))).toThrow(PerformanceInputError);
    expect(() => parsePerformanceSamples(new TextEncoder().encode("{"))).toThrow(PerformanceInputError);
});

test("body byte budget rejects even otherwise valid JSON with excess whitespace", () => {
    const json = JSON.stringify({ samples: [sample] });
    expect(parsePerformanceSamples(new TextEncoder().encode(json.padEnd(2048)))).toHaveLength(1);
    try { parsePerformanceSamples(new TextEncoder().encode(json.padEnd(2049))); throw new Error("accepted oversized body"); }
    catch (error) { expect(error).toBeInstanceOf(PerformanceInputError); expect((error as PerformanceInputError).status).toBe(413); }
    expect(() => parsePerformanceSamples(encode({ samples: [sample], extra: "图".repeat(700) }))).toThrow("请求内容过大");
});

test("fixed histograms return bucket upper bounds and noncumulative counts", () => {
    const metrics = new PerformanceMetrics(0);
    for (const durationMs of [0, 50, 51, 100, 101, 250, 500, 1000, 1001, 300000])
        metrics.recordFrontend({ route: "/image", name: "ttfb", durationMs });
    const row = metrics.snapshot().series[0];
    expect(row.count).toBe(10);
    expect(row.p50UpperMs).toBe(250);
    expect(row.p95UpperMs).toBe(300000);
    expect(row.buckets.slice(0, 3).map((bucket) => bucket.count)).toEqual([2, 2, 2]);
    expect(row.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(row.count);
    metrics.recordImage("image_job_total", "failed", 900000);
    expect(metrics.snapshot().series[1].p95UpperMs).toBeNull();
    expect(metrics.snapshot().series[1].buckets.at(-1)).toEqual({ upperMs: null, count: 1 });
});

test("labels stay bounded, image outcomes separate, and snapshots cannot mutate storage", () => {
    const metrics = new PerformanceMetrics();
    for (const route of PERFORMANCE_ROUTES) for (const name of FRONTEND_PERFORMANCE_NAMES) metrics.recordFrontend({ route, name, durationMs: 1 });
    for (let index = 0; index < 1000; index++) metrics.recordFrontend({ route: `/private/${index}` as never, name: "ttfb", durationMs: 1 });
    metrics.recordFrontend({ route: "/image", name: "secret" as never, durationMs: 1 });
    for (const durationMs of [NaN, Infinity, -1, 300001]) metrics.recordFrontend({ route: "/image", name: "ttfb", durationMs });
    for (const outcome of ["succeeded", "failed", "canceled"] as const) metrics.recordImage("image_job_outcome", outcome, 0);
    metrics.recordImage("secret" as never, "failed", 1);
    metrics.recordImage("image_job_total", "secret" as never, 1);
    const result = metrics.snapshot();
    expect(result.series).toHaveLength(PERFORMANCE_ROUTES.length * 3 + 3);
    expect(result.series.every((row) => row.count === 1)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
    result.series[0].buckets[0].count = 900;
    expect(metrics.snapshot().series[0].buckets[0].count).toBe(1);
});

test("new process instance resets all series and start time", () => {
    const old = new PerformanceMetrics(0);
    old.recordImage("image_job_total", "succeeded", 42);
    const fresh = new PerformanceMetrics(1000).snapshot();
    expect(old.snapshot().series).toHaveLength(1);
    expect(fresh).toEqual({ since: "1970-01-01T00:00:01.000Z", lifetime: "process", series: [] });
});

test("limits each user to twelve requests per minute without evicting active limits", () => {
    const limiter = new PerformanceRateLimiter(2);
    for (let index = 0; index < 12; index++) expect(limiter.accept("user-a", 0)).toBe(true);
    expect(limiter.accept("user-a", 59999)).toBe(false);
    expect(limiter.accept("user-b", 0)).toBe(true);
    expect(limiter.accept("user-c", 1)).toBe(false);
    expect(limiter.accept("user-a", 1)).toBe(false);
    expect(limiter.accept("user-a", 60000)).toBe(true);
    expect(limiter.accept("user-c", 60000)).toBe(true);
});

test("endpoint wiring requires authentication, origin, payload cap, rate and admin guards", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();
    const start = source.indexOf('if (url.pathname.startsWith("/api/"))');
    const post = source.indexOf('if (url.pathname === "/api/performance"');
    const admin = source.indexOf('if (url.pathname === "/api/admin/performance"');
    expect(start).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(start);
    const guards = source.slice(start, post);
    expect(guards).toContain("enforceSameOrigin(request)");
    expect(guards).toContain("requireSession(request)");
    const handler = source.slice(post, admin);
    expect(handler).toContain('request.method === "POST"');
    expect(handler.indexOf("performanceRateLimiter.accept(session.userId)")).toBeLessThan(handler.indexOf("parsePerformanceSamples"));
    expect(handler).toContain('readRequestBytes(request, PERFORMANCE_BODY_BYTES, "请求内容过大")');
    expect(handler).toContain('{ event: "frontend_performance", requestId, samples }');
    expect(handler).toContain("status: 204");
    const adminHandler = source.slice(admin, source.indexOf('if (url.pathname === "/api/admin/metrics"', admin));
    expect(adminHandler).toContain('request.method === "GET"');
    expect(adminHandler.indexOf("requireAdmin(session)")).toBeLessThan(adminHandler.indexOf("performanceMetrics.snapshot()"));
    expect(adminHandler).toContain('"private, no-store"');
});

test("persisting phase begins after upstream completes and clears in finally", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();
    const worker = source.slice(source.indexOf("async function runImageJob("), source.indexOf("async function materializeImageInput("));
    expect(worker.indexOf('imageJobPhases.set(job.id, "persisting")')).toBeGreaterThan(worker.indexOf("upstreamFinishedAt = Date.now()"));
    expect(worker).toContain("finally {\n        imageJobPhases.delete(job.id);");
    expect(source).toContain('job.status !== "running" ? "completed" : imageJobPhases.get(job.id)');
    expect(source).toContain('state.jobs[job.id]?.status !== job.status');
});

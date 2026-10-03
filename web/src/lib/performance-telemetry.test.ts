import { describe, expect, test } from "bun:test";
import { createPerformanceReporter, performanceRoute } from "./performance-telemetry";

describe("private bounded page timing", () => {
    test("route measurement resets only for pathname changes, not query or hash navigation", async () => {
        const source = await Bun.file(new URL("../router.tsx", import.meta.url)).text();
        const wrapper = source.slice(source.indexOf("function RoutePage("), source.indexOf("function RouteLoading("));
        expect(wrapper).toContain("key={location.pathname}");
        expect(wrapper).not.toContain("location.key");
        expect(wrapper).not.toContain("location.search");
        expect(wrapper).not.toContain("location.hash");
    });
    test("strips identifiers, queries and unknown paths", () => {
        expect(performanceRoute("/canvas/private-id?token=secret#private")).toBe("/canvas/:id");
        expect(performanceRoute("/image?prompt=secret")).toBe("/image");
        expect(performanceRoute("/private/person")).toBe("/other");
    });

    test("limits volume, discards invalid durations and never sends extra fields", async () => {
        const original = globalThis.fetch;
        const bodies: string[] = [];
        globalThis.fetch = (async (_url, init) => {
            expect(init?.referrerPolicy).toBe("no-referrer");
            expect(init?.redirect).toBe("error");
            expect(init?.keepalive).toBe(true);
            bodies.push(String(init?.body)); return new Response(null, { status: 204 });
        }) as typeof fetch;
        try {
            const report = createPerformanceReporter();
            const sample = { route: "/canvas/private?token=secret", name: "route_ready" as const, durationMs: 123.4, prompt: "secret" };
            expect(report([{ ...sample, durationMs: NaN }], 0)).toBe(false);
            expect(report([{ ...sample, name: "private prompt" as never }], 0)).toBe(false);
            expect(report([sample], NaN)).toBe(false);
            expect(report([sample], 0)).toBe(true);
            expect(report([sample], 1)).toBe(true); // accepted into the bounded queue
            expect(bodies).toHaveLength(1);
            for (let i = 1; i < 100; i++) report([sample], i * 6000);
            expect(bodies).toHaveLength(60);
            expect(JSON.parse(bodies[0])).toEqual({ samples: [{ route: "/canvas/:id", name: "route_ready", durationMs: 123 }] });
            await Promise.resolve();
            await Promise.resolve();
        } finally { globalThis.fetch = original; }
    });

    test("network failure is ignored without retry", async () => {
        const original = globalThis.fetch;
        let count = 0;
        globalThis.fetch = (async () => { count++; throw new TypeError("offline"); }) as typeof fetch;
        try {
            createPerformanceReporter()([{ route: "/", name: "ttfb", durationMs: 50 }], 0);
            await Promise.resolve();
            await Promise.resolve();
            expect(count).toBe(1);
        } finally { globalThis.fetch = original; }
    });
});

test("late LCP and interaction windows survive cooldown, coalesce and flush only once on quick exit", async () => {
    const original = globalThis.fetch;
    const bodies: { samples: { name: string; durationMs: number }[] }[] = [];
    globalThis.fetch = (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }) as typeof fetch;
    const report = createPerformanceReporter();
    try {
        report([{ route: "/image", name: "route_ready", durationMs: 50 }], 0);
        report([{ route: "/canvas/private?token=secret", name: "lcp", durationMs: 1234.5 }], 1);
        for (const durationMs of [100, 200, 160]) report([{ route: "/image", name: "event_interaction_latency", durationMs }], 2);
        expect(bodies).toHaveLength(1);
        expect(report.flush(true, 3)).toBe(true);
        expect(report.flush(true, 3)).toBe(false);
        expect(bodies[1].samples).toEqual([
            { route: "/canvas/:id", name: "lcp", durationMs: 1235 },
            { route: "/image", name: "event_interaction_latency", durationMs: 200 },
        ]);
        report([{ route: "/image", name: "event_interaction_latency", durationMs: 88 }], 4);
        expect(report.flush(true, 5)).toBe(false); // no repeated lifecycle rate-limit bypass
        expect(report.flush(false, 6003)).toBe(true);
        expect(bodies).toHaveLength(3);
        expect(JSON.stringify(bodies)).not.toContain("secret");
        await Promise.resolve();
    } finally { report.clear(); globalThis.fetch = original; }
});

test("queue is capped at twelve sanitized samples and discards data when the account is no longer eligible", async () => {
    const original = globalThis.fetch;
    const bodies: { samples: unknown[] }[] = [];
    let enabled = true;
    const report = createPerformanceReporter({ isEnabled: () => enabled });
    globalThis.fetch = (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }) as typeof fetch;
    try {
        report([{ route: "/", name: "ttfb", durationMs: 1 }], 0);
        for (const route of ["/", "/canvas", "/chat", "/image", "/wallet", "/prompts"]) {
            for (const name of ["route_ready", "lcp", "event_interaction_latency"] as const) report([{ route, name, durationMs: 42 }], 1);
        }
        for (let time = 6000; time <= 30000; time += 6000) report.flush(false, time);
        expect(bodies.slice(1).flatMap((body) => body.samples)).toHaveLength(12);
        expect(bodies.every((body) => body.samples.length <= 3)).toBe(true);
        report([{ route: "/", name: "lcp", durationMs: 700 }], 24001);
        enabled = false;
        expect(report.flush(true, 30000)).toBe(false);
        enabled = true;
        expect(report.flush(false, 40000)).toBe(false);
        expect(bodies).toHaveLength(5);
        await Promise.resolve();
    } finally { report.clear(); globalThis.fetch = original; }
});

test("synchronous transport failure is also silent and never retried", () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("transport unavailable"); }) as typeof fetch;
    const report = createPerformanceReporter();
    try {
        expect(() => report([{ route: "/", name: "lcp", durationMs: 100 }], 0)).not.toThrow();
        expect(report.flush(false, 6000)).toBe(false);
        expect(calls).toBe(1);
    } finally { report.clear(); globalThis.fetch = original; }
});

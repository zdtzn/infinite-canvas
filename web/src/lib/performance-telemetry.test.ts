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
            bodies.push(String(init?.body)); return new Response(null, { status: 204 });
        }) as typeof fetch;
        try {
            const report = createPerformanceReporter();
            const sample = { route: "/canvas/private?token=secret", name: "route_ready" as const, durationMs: 123.4, prompt: "secret" };
            expect(report([{ ...sample, durationMs: NaN }], 0)).toBe(false);
            expect(report([{ ...sample, name: "private prompt" as never }], 0)).toBe(false);
            expect(report([sample], NaN)).toBe(false);
            expect(report([sample], 0)).toBe(true);
            expect(report([sample], 1)).toBe(false);
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

import { expect, test } from "bun:test";
import { createPerceivedPerformance } from "./performance-telemetry-observers";
import type { PerformanceSample } from "./performance-telemetry";

// Exercise native observer/lifecycle behavior without a DOM or wall-clock delays.
function fixture({ hidden = false, supported = ["largest-contentful-paint", "event"], fails = "", activationStart = 0, hiddenBeforeMount = false } = {}) {
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const replace = (name: string, value: unknown) => {
        originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    let time = 100;
    let visibility = hidden ? "hidden" : "visible";
    let sequence = 0;
    let flushes = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    Object.defineProperty(documentTarget, "visibilityState", { get: () => visibility });
    const observers: FakeObserver[] = [];
    class FakeObserver {
        static supportedEntryTypes = supported;
        options?: PerformanceObserverInit;
        connected = false;
        records: PerformanceEntry[] = [];
        constructor(readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void) { observers.push(this); }
        observe(options: PerformanceObserverInit) {
            this.options = options;
            if (options.type === fails) throw new Error("not supported");
            this.connected = true;
        }
        disconnect() { this.connected = false; this.records = []; }
        takeRecords() { return this.records.splice(0); }
        emit(entries: PerformanceEntry[]) { if (this.connected) this.callback({ getEntries: () => entries }); }
    }
    replace("window", windowTarget);
    replace("document", documentTarget);
    replace("performance", { now: () => time, getEntriesByType: (type: string) => type === "navigation"
        ? [{ name: "https://fixture.test/canvas/private-id?prompt=secret#private", activationStart }]
        : type === "visibility-state" && hiddenBeforeMount ? [{ name: "hidden", startTime: 0 }] : [] });
    replace("PerformanceObserver", FakeObserver);
    replace("setTimeout", (callback: () => void, delay: number) => { const id = ++sequence; timers.set(id, { at: time + delay, callback }); return id; });
    replace("clearTimeout", (id: number) => timers.delete(id));
    const samples: PerformanceSample[] = [];
    const tracker = createPerceivedPerformance((values) => { samples.push(...values); return true; }, () => { flushes++; });
    const latest = (type: string) => observers.findLast((observer) => observer.options?.type === type && observer.connected);
    return {
        tracker, samples, observers, timers, latest,
        get flushes() { return flushes; },
        time(value: number) { time = value; },
        advance(value: number) {
            time = value;
            for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
        },
        paint(...times: number[]) { latest("largest-contentful-paint")?.emit(times.map((startTime) => ({ startTime, duration: 0, url: "https://private.test", element: { textContent: "secret" } }) as unknown as PerformanceEntry)); },
        events(...values: Array<Partial<PerformanceEntry> & { interactionId?: number }>) {
            latest("event")?.emit(values.map((value) => ({ startTime: time, duration: 96, interactionId: 1, target: { textContent: "secret" }, ...value }) as unknown as PerformanceEntry));
        },
        visibility(value: "hidden" | "visible") { visibility = value; documentTarget.dispatchEvent(new Event("visibilitychange")); },
        pagehide() { windowTarget.dispatchEvent(new Event("pagehide")); },
        pageshow() { windowTarget.dispatchEvent(new Event("pageshow")); },
        cleanup() {
            tracker.stop();
            for (const [name, descriptor] of originals) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        },
    };
}

test("LCP uses the last paint start time, is drained at SPA boundaries and remains on the document route", () => {
    const f = fixture();
    try {
        f.tracker.start("/canvas/private-id?token=secret", 100);
        expect(f.latest("largest-contentful-paint")?.options?.buffered).toBe(true);
        f.paint(150, 1200);
        f.latest("largest-contentful-paint")!.records.push({ startTime: 2400, duration: 0 } as PerformanceEntry);
        f.time(2500);
        f.tracker.start("/image?prompt=secret", 2500);
        f.paint(8000);
        f.pagehide();
        f.pagehide();
        expect(f.samples).toEqual([{ route: "/canvas/:id", name: "lcp", durationMs: 2400 }]);
        expect(JSON.stringify(f.samples)).not.toContain("secret");
        expect(f.latest("largest-contentful-paint")).toBeUndefined();
    } finally { f.cleanup(); }
});

test("same route acquisition does not duplicate observers and same-category navigation still closes LCP", () => {
    const f = fixture();
    try {
        f.tracker.start("/canvas/one", 100);
        f.tracker.start("/canvas/one?filter=x", 100);
        expect(f.observers).toHaveLength(2);
        f.paint(120);
        f.time(200);
        f.tracker.start("/canvas/two", 200);
        expect(f.samples).toEqual([{ route: "/canvas/:id", name: "lcp", durationMs: 120 }]);
        f.tracker.start("/image", 300);
        expect(f.samples).toHaveLength(1);
    } finally { f.cleanup(); }
});

test("interaction latency is a bounded window maximum, excludes old/invalid/noninteraction entries, and drains on route change", () => {
    const f = fixture();
    try {
        f.tracker.start("/canvas/one", 100);
        expect(f.latest("event")?.options).toEqual({ type: "event", buffered: false, durationThreshold: 16 });
        f.events({ duration: 999, startTime: 99 }, { duration: 999, interactionId: 0 }, { duration: NaN }, { duration: 300001 }, { startTime: NaN }, { duration: 8 });
        expect(f.timers.size).toBe(0);
        for (let i = 0; i < 10000; i++) f.events({ duration: i % 2 ? 160 : 96 });
        expect(f.timers.size).toBe(1);
        expect(f.samples).toHaveLength(0);
        f.advance(6100);
        expect(f.samples).toEqual([{ route: "/canvas/:id", name: "event_interaction_latency", durationMs: 160 }]);
        expect(f.timers.size).toBe(0);
        f.latest("event")!.records.push({ startTime: 6200, duration: 192, interactionId: 2 } as unknown as PerformanceEntry);
        f.time(6500);
        f.tracker.start("/image", 6500);
        f.events({ startTime: 6400, duration: 500 }, { startTime: 6550, duration: 80 });
        f.time(7000);
        f.pagehide();
        expect(f.samples.slice(1)).toEqual([
            { route: "/canvas/:id", name: "event_interaction_latency", durationMs: 192 },
            { route: "/image", name: "event_interaction_latency", durationMs: 80 },
        ]);
        expect(f.timers.size).toBe(0);
    } finally { f.cleanup(); }
});

test("visibility and pagehide drain once, resume fresh events after restoration and never replay document LCP", () => {
    const f = fixture();
    try {
        f.tracker.start("/image", 100);
        f.paint(200);
        f.events({ startTime: 250, duration: 80 });
        f.time(500);
        f.visibility("hidden");
        f.pagehide();
        expect(f.samples).toHaveLength(2);
        expect(f.observers.every((observer) => !observer.connected)).toBe(true);
        f.time(1000);
        f.visibility("visible");
        f.pageshow();
        expect(f.observers.filter((observer) => observer.connected)).toHaveLength(1);
        f.events({ startTime: 750, duration: 160 }, { startTime: 1100, duration: 32 });
        f.time(1500);
        f.pagehide();
        expect(f.samples).toHaveLength(3);
        expect(f.samples[2]).toEqual({ route: "/image", name: "event_interaction_latency", durationMs: 32 });
        expect(f.samples.filter((sample) => sample.name === "lcp")).toHaveLength(1);
        f.tracker.stop();
        const flushes = f.flushes;
        f.visibility("hidden");
        f.pageshow();
        f.pagehide();
        expect(f.flushes).toBe(flushes);
        expect(f.timers.size).toBe(0);
    } finally { f.cleanup(); }
});

test("interaction attribution starts at route commit, not an earlier concurrent render", () => {
    const f = fixture();
    try {
        f.tracker.start("/canvas/one", 100);
        f.latest("event")!.records.push({ startTime: 250, duration: 32, interactionId: 1 } as unknown as PerformanceEntry);
        f.time(300);
        f.tracker.start("/image", 200); // render began at 200 while the old UI was still visible
        f.events({ startTime: 280, duration: 192 }, { startTime: 320, duration: 64 });
        f.time(500);
        f.pagehide();
        expect(f.samples).toEqual([
            { route: "/canvas/:id", name: "event_interaction_latency", durationMs: 32 },
            { route: "/image", name: "event_interaction_latency", durationMs: 64 },
        ]);
    } finally { f.cleanup(); }
});

test("background-loaded, previously hidden, and prerendered documents do not manufacture LCP", () => {
    for (const options of [{ hidden: true }, { hiddenBeforeMount: true }, { activationStart: 80 }]) {
        const f = fixture(options);
        try {
            f.tracker.start("/image", 100);
            f.visibility("visible");
            f.paint(1000);
            f.time(1200);
            f.pagehide();
            expect(f.samples).toHaveLength(0);
            expect(f.latest("largest-contentful-paint")).toBeUndefined();
        } finally { f.cleanup(); }
    }
});

test("an out-of-budget final LCP is omitted instead of reporting an earlier smaller candidate", () => {
    const f = fixture();
    try {
        f.tracker.start("/image", 100);
        f.paint(1200, 300001);
        f.time(300002);
        f.pagehide();
        expect(f.samples).toHaveLength(0);
    } finally { f.cleanup(); }
});

test("missing/throwing observers degrade independently without errors or dangling observers", () => {
    for (const options of [{ supported: [] }, { fails: "event" }, { fails: "largest-contentful-paint" }]) {
        const f = fixture(options);
        try {
            expect(() => f.tracker.start("/image", 100)).not.toThrow();
            f.paint(200);
            f.events({ startTime: 250, duration: 80 });
            f.time(500);
            f.pagehide();
            if (options.fails === "event") expect(f.samples.map((sample) => sample.name)).toEqual(["lcp"]);
            else if (options.fails === "largest-contentful-paint") expect(f.samples.map((sample) => sample.name)).toEqual(["event_interaction_latency"]);
            else expect(f.samples).toHaveLength(0);
            f.tracker.stop();
            expect(f.observers.every((observer) => !observer.connected)).toBe(true);
            expect(f.timers.size).toBe(0);
        } finally { f.cleanup(); }
    }
});

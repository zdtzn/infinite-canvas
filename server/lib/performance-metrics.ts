export const PERFORMANCE_ROUTES = ["/", "/canvas", "/canvas/:id", "/chat", "/image", "/color-alchemy", "/wallet", "/cultivation", "/prompts", "/assets", "/video", "/announcements", "/config", "/docs", "/admin/cultivation", "/other"] as const;
export const FRONTEND_PERFORMANCE_NAMES = ["route_ready", "document_ready", "ttfb", "lcp", "event_interaction_latency"] as const;
export const PERFORMANCE_BODY_BYTES = 2048;
export const PERFORMANCE_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000] as const;
const LCP_BUCKETS_MS = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 10000, 30000, 60000, 120000, 300000];
const INTERACTION_BUCKETS_MS = [16, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000];
const IMAGE_NAMES = ["image_job_queue", "image_job_upstream", "image_job_persistence", "image_job_total", "image_job_outcome"] as const;
type Route = typeof PERFORMANCE_ROUTES[number];
type FrontendName = typeof FRONTEND_PERFORMANCE_NAMES[number];
type ImageName = typeof IMAGE_NAMES[number];
export type ImagePerformanceOutcome = "succeeded" | "failed" | "canceled";
export type FrontendPerformanceSample = { route: Route; name: FrontendName; durationMs: number };

export class PerformanceInputError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/** Keep active limits even at capacity: reject new keys instead of evicting them. */
export class PerformanceRateLimiter {
    private readonly users = new Map<string, { count: number; resetAt: number }>();
    private nextSweepAt = 0;
    constructor(private readonly capacity = 10000) {}

    accept(userId: string, now = Date.now()) {
        if (now >= this.nextSweepAt) {
            for (const [id, bucket] of this.users) if (bucket.resetAt <= now) this.users.delete(id);
            this.nextSweepAt = now + 60000;
        }
        let bucket = this.users.get(userId);
        if (bucket && bucket.resetAt <= now) { this.users.delete(userId); bucket = undefined; }
        if (!bucket) {
            if (this.users.size >= this.capacity) return false;
            this.users.set(userId, { count: 1, resetAt: now + 60000 });
            return true;
        }
        if (bucket.count >= 12) return false;
        bucket.count += 1;
        return true;
    }
}

export function parsePerformanceSamples(bytes: Uint8Array): FrontendPerformanceSample[] {
    if (bytes.byteLength > PERFORMANCE_BODY_BYTES) throw new PerformanceInputError(413, "请求内容过大");
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new PerformanceInputError(400, "JSON 格式无效"); }
    const invalid = () => new PerformanceInputError(400, "性能采样格式无效");
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("samples" in body)) throw invalid();
    if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > 3) throw invalid();
    return body.samples.map((sample: unknown) => {
        if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw invalid();
        const value = sample as Record<string, unknown>;
        if (Object.keys(value).length !== 3 || !PERFORMANCE_ROUTES.includes(value.route as Route) || !FRONTEND_PERFORMANCE_NAMES.includes(value.name as FrontendName) ||
            typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 300000) throw invalid();
        return { route: value.route as Route, name: value.name as FrontendName, durationMs: value.durationMs };
    });
}

type Histogram = { route: Route; name: FrontendName | ImageName; outcome: "observed" | ImagePerformanceOutcome; count: number; buckets: number[] };
const boundsFor = (name: Histogram["name"]): readonly number[] => name === "lcp" ? LCP_BUCKETS_MS : name === "event_interaction_latency" ? INTERACTION_BUCKETS_MS : PERFORMANCE_BUCKETS_MS;

/** Process-local fixed-label histograms. No samples, job IDs or user IDs are retained. */
export class PerformanceMetrics {
    private readonly since: string;
    private readonly series = new Map<string, Histogram>();

    constructor(now = Date.now()) { this.since = new Date(now).toISOString(); }

    recordFrontend(sample: FrontendPerformanceSample) {
        if (!PERFORMANCE_ROUTES.includes(sample.route) || !FRONTEND_PERFORMANCE_NAMES.includes(sample.name) || sample.durationMs > 300000) return;
        this.record(sample.route, sample.name, "observed", sample.durationMs);
    }

    recordImage(name: ImageName, outcome: ImagePerformanceOutcome, durationMs: number) {
        if (!IMAGE_NAMES.includes(name) || !["succeeded", "failed", "canceled"].includes(outcome)) return;
        this.record("/image", name, outcome, durationMs);
    }

    private record(route: Route, name: Histogram["name"], outcome: Histogram["outcome"], durationMs: number) {
        if (!Number.isFinite(durationMs) || durationMs < 0) return;
        const key = `${route}:${name}:${outcome}`;
        const bounds = boundsFor(name);
        let histogram = this.series.get(key);
        if (!histogram) {
            histogram = { route, name, outcome, count: 0, buckets: Array(bounds.length + 1).fill(0) };
            this.series.set(key, histogram);
        }
        const index = bounds.findIndex((upper) => durationMs <= upper);
        histogram.buckets[index < 0 ? bounds.length : index] += 1;
        histogram.count += 1;
    }

    snapshot() {
        return { since: this.since, lifetime: "process" as const, series: [...this.series.values()].map((histogram) => {
            const bounds = boundsFor(histogram.name);
            const unit = histogram.name === "image_job_outcome" ? "count" as const : "ms" as const;
            const percentile = (fraction: number) => {
                if (unit === "count") return null;
                let count = 0;
                for (let index = 0; index < histogram.buckets.length; index++) {
                    count += histogram.buckets[index];
                    if (count >= Math.ceil(histogram.count * fraction)) return bounds[index] ?? null;
                }
                return null;
            };
            return { route: histogram.route, name: histogram.name, outcome: histogram.outcome, unit, count: histogram.count,
                p50UpperMs: percentile(0.5), p95UpperMs: percentile(0.95),
                buckets: unit === "count" ? [] : histogram.buckets.map((count, index) => ({ upperMs: bounds[index] ?? null, count })) };
        }) };
    }
}

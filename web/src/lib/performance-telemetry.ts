const routes = new Set(["/", "/canvas", "/chat", "/image", "/color-alchemy", "/wallet", "/cultivation", "/prompts", "/assets", "/video", "/announcements", "/config", "/docs", "/admin/cultivation"]);
export type PerformanceSample = { route: string; name: "route_ready" | "document_ready" | "ttfb"; durationMs: number };
const names = new Set<PerformanceSample["name"]>(["route_ready", "document_ready", "ttfb"]);

export function performanceRoute(path: string) {
    const pathname = path.split(/[?#]/, 1)[0];
    if (/^\/canvas\/[^/]+$/.test(pathname)) return "/canvas/:id";
    return routes.has(pathname) ? pathname : "/other";
}

// No queue, persistence, retries, URLs or user-provided labels. Failure is silent.
export function createPerformanceReporter() {
    let lastSent = -Infinity;
    let sent = 0;
    return (samples: PerformanceSample[], now = performance.now()) => {
        if (!Number.isFinite(now) || sent >= 60 || now - lastSent < 6000) return false;
        const safe = samples.slice(0, 3).filter((s) => names.has(s.name) && Number.isFinite(s.durationMs) && s.durationMs >= 0 && s.durationMs <= 300000)
            .map((s) => ({ route: performanceRoute(s.route), name: s.name, durationMs: Math.round(s.durationMs) }));
        if (!safe.length) return false;
        sent++;
        lastSent = now;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        void fetch("/api/performance", {
            method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
            referrerPolicy: "no-referrer", redirect: "error",
            body: JSON.stringify({ samples: safe }), signal: controller.signal,
        }).catch(() => undefined).finally(() => clearTimeout(timer));
        return true;
    };
}

export const reportPerformance = createPerformanceReporter();

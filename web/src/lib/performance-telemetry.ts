const routes = new Set(["/", "/canvas", "/chat", "/image", "/color-alchemy", "/wallet", "/cultivation", "/prompts", "/assets", "/video", "/announcements", "/config", "/docs", "/admin/cultivation"]);
export type PerformanceSample = { route: string; name: "route_ready" | "document_ready" | "ttfb" | "lcp" | "event_interaction_latency"; durationMs: number };
const names = new Set<PerformanceSample["name"]>(["route_ready", "document_ready", "ttfb", "lcp", "event_interaction_latency"]);

export function performanceRoute(path: string) {
    const pathname = path.split(/[?#]/, 1)[0];
    if (/^\/canvas\/[^/]+$/.test(pathname)) return "/canvas/:id";
    return routes.has(pathname) ? pathname : "/other";
}

// At most 12 sanitized pending samples, 3 per request, 60 requests per document.
// No persistence or retries. One extra lifecycle flush is reserved for a quick exit.
export function createPerformanceReporter(
    { isEnabled = () => true, now = () => performance.now() }: { isEnabled?: () => boolean; now?: () => number } = {},
) {
    let lastSent = -Infinity;
    let sent = 0;
    let exitFlushUsed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, PerformanceSample>();
    const clear = () => { clearTimeout(timer); timer = undefined; pending.clear(); };
    const flush = (exiting = false, time = now()): boolean => {
        clearTimeout(timer);
        timer = undefined;
        if (!isEnabled() || sent >= 60) { clear(); return false; }
        if (!pending.size || !Number.isFinite(time)) return false;
        if (time - lastSent < 6000) {
            if (exiting && !exitFlushUsed) exitFlushUsed = true;
            else {
                timer = setTimeout(() => flush(), Math.max(1, 6000 - (time - lastSent)));
                return false;
            }
        }
        const safe = [...pending.values()].slice(0, 3);
        for (const sample of safe) pending.delete(`${sample.route}:${sample.name}`);
        sent++;
        lastSent = time;
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 3000);
        try {
            void fetch("/api/performance", {
                method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
                referrerPolicy: "no-referrer", redirect: "error", keepalive: true,
                body: JSON.stringify({ samples: safe }), signal: controller.signal,
            }).catch(() => undefined).finally(() => clearTimeout(abortTimer));
        } catch { clearTimeout(abortTimer); }
        if (pending.size && sent < 60) timer = setTimeout(() => flush(), 6000);
        if (sent >= 60) clear();
        return true;
    };
    const report = (samples: PerformanceSample[], time = now()) => {
        if (!isEnabled() || sent >= 60) { clear(); return false; }
        if (!Number.isFinite(time)) return false;
        let accepted = false;
        for (const sample of samples.slice(0, 3)) {
            if (!names.has(sample.name) || typeof sample.route !== "string" || !Number.isFinite(sample.durationMs) || sample.durationMs < 0 || sample.durationMs > 300000) continue;
            const safe = { route: performanceRoute(sample.route), name: sample.name, durationMs: Math.round(sample.durationMs) };
            const key = `${safe.route}:${safe.name}`;
            if (pending.size >= 12 && !pending.has(key)) continue;
            // Coalesce unsent interaction windows to their worst observed event.
            if (safe.name === "event_interaction_latency") safe.durationMs = Math.max(safe.durationMs, pending.get(key)?.durationMs ?? 0);
            pending.set(key, safe);
            accepted = true;
        }
        if (accepted) flush(false, time);
        return accepted;
    };
    return Object.assign(report, { flush, clear });
}

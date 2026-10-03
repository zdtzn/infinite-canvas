import { performanceRoute, type PerformanceSample } from "./performance-telemetry";

type TimingEntry = PerformanceEntry & { interactionId?: number };

/** Document LCP and the slowest Event Timing interaction in each active 6s window.
 * This deliberately does not claim INP: fast events and cross-frame input are absent.
 * Questions answered: when did initial content paint, and which routes feel slow to use?
 */
export function createPerceivedPerformance(report: (samples: PerformanceSample[]) => boolean, flush: () => void) {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    let documentRoute = "/other";
    try { documentRoute = performanceRoute(new URL(navigation?.name ?? location.href).pathname); } catch { /* no raw URL fallback */ }
    let firstHidden = document.visibilityState === "visible" ? Infinity : 0;
    // A buffered visibility timeline also excludes documents hidden before auth/mount.
    for (const entry of performance.getEntriesByType("visibility-state")) {
        if (entry.name === "hidden") firstHidden = Math.min(firstHidden, entry.startTime);
    }
    let route = "/other";
    let routeStart = -1;
    let routeEpoch = -1;
    let visibleStart = 0;
    let visibleEnd = Infinity;
    let running = false;
    let lcpClosed = false;
    let lcp: number | undefined;
    let lcpObserver: PerformanceObserver | undefined;
    let eventObserver: PerformanceObserver | undefined;
    let worstEvent = 0;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;

    const readLcp = (entries: PerformanceEntry[]) => {
        if (lcpClosed) return;
        for (const entry of entries) {
            if (Number.isFinite(entry.startTime) && entry.startTime >= 0 && entry.startTime < firstHidden) lcp = entry.startTime;
        }
    };
    const finishLcp = () => {
        if (lcpClosed) return;
        readLcp(lcpObserver?.takeRecords() ?? []);
        lcpObserver?.disconnect();
        lcpObserver = undefined;
        lcpClosed = true;
        clearTimeout(inputTimer);
        inputTimer = undefined;
        window.removeEventListener("click", onInput, true);
        window.removeEventListener("keydown", onInput, true);
        if (lcp !== undefined && lcp <= 300000) report([{ route: documentRoute, name: "lcp", durationMs: lcp }]);
    };
    const sendEvents = () => {
        clearTimeout(eventTimer);
        eventTimer = undefined;
        if (worstEvent) report([{ route, name: "event_interaction_latency", durationMs: worstEvent }]);
        worstEvent = 0;
    };
    const readEvents = (entries: PerformanceEntry[]) => {
        for (const entry of entries as TimingEntry[]) {
            // Discard late records from a previous route/visibility epoch. Never read
            // target, event name, interaction identifiers into a retained sample.
            if (!entry.interactionId || entry.interactionId < 0 || !Number.isFinite(entry.startTime) || entry.startTime < Math.max(routeStart, visibleStart) || entry.startTime + entry.duration > visibleEnd ||
                !Number.isFinite(entry.duration) || entry.duration < 16 || entry.duration > 300000) continue;
            worstEvent = Math.max(worstEvent, entry.duration);
        }
        if (worstEvent && eventTimer === undefined) eventTimer = setTimeout(() => { readEvents(eventObserver?.takeRecords() ?? []); sendEvents(); }, 6000);
    };
    const observe = (type: string, read: (entries: PerformanceEntry[]) => void, buffered: boolean) => {
        let observer: PerformanceObserver | undefined;
        try {
            if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes(type)) return;
            observer = new PerformanceObserver((list) => { if (running) read(list.getEntries()); });
            observer.observe({ type, buffered, ...(type === "event" ? { durationThreshold: 16 } : {}) });
            return observer;
        } catch { observer?.disconnect(); return; }
    };
    const startEvents = () => {
        visibleStart = performance.now();
        visibleEnd = Infinity;
        eventObserver = observe("event", readEvents, false);
    };
    function onInput(event: Event) {
        // Defer work until after the input handler; do not add transport work to it.
        if (event.isTrusted && inputTimer === undefined) inputTimer = setTimeout(finishLcp, 0);
    }
    const hide = () => {
        firstHidden = Math.min(firstHidden, performance.now());
        visibleEnd = performance.now();
        finishLcp();
        readEvents(eventObserver?.takeRecords() ?? []);
        eventObserver?.disconnect();
        eventObserver = undefined;
        sendEvents();
        flush();
    };
    const onVisibility = () => {
        if (document.visibilityState !== "visible") hide();
        else if (!eventObserver) startEvents();
    };
    const onPageShow = () => { if (document.visibilityState === "visible" && !eventObserver) startEvents(); };

    return {
        start(pathname: string, startedAt: number) {
            if (running && startedAt === routeEpoch) return;
            if (running) {
                // Drain the previous route before changing labels. LCP never restarts
                // on SPA navigation, including navigation within one route category.
                finishLcp();
                readEvents(eventObserver?.takeRecords() ?? []);
                sendEvents();
            }
            route = performanceRoute(pathname);
            routeEpoch = startedAt;
            // Render may start well before this route commits during a transition.
            // Only events starting on the committed screen get its route label.
            routeStart = performance.now();
            if (running) return;
            running = true;
            if (!lcpClosed) {
                // Prerender activation and BFCache need different LCP definitions;
                // omit those samples rather than reusing a document-load value.
                if (firstHidden === 0 || (navigation as PerformanceNavigationTiming & { activationStart?: number })?.activationStart) lcpClosed = true;
                else lcpObserver = observe("largest-contentful-paint", readLcp, true);
                if (lcpObserver) {
                    window.addEventListener("click", onInput, { capture: true, passive: true });
                    window.addEventListener("keydown", onInput, { capture: true, passive: true });
                }
            }
            if (document.visibilityState === "visible") startEvents();
            document.addEventListener("visibilitychange", onVisibility);
            window.addEventListener("pagehide", hide);
            window.addEventListener("pageshow", onPageShow);
        },
        stop() {
            if (!running) return;
            hide();
            running = false;
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("pagehide", hide);
            window.removeEventListener("pageshow", onPageShow);
        },
    };
}

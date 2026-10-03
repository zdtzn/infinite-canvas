import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { createPerformanceReporter, performanceRoute, type PerformanceSample } from "@/lib/performance-telemetry";
import { createPerceivedPerformance } from "@/lib/performance-telemetry-observers";
import { useUserStore } from "@/stores/use-user-store";

let documentReported = false;
let activeOwner: string | undefined;
let lease = 0;
const reportPerformance = createPerformanceReporter({ isEnabled: () => !!PUBLIC_MODE && !!activeOwner && useUserStore.getState().user?.id === activeOwner });
let perceived: ReturnType<typeof createPerceivedPerformance> | undefined;

/** The clock must live outside Suspense, whose uncommitted state can be discarded. */
export function MeasuredRoute({ children, pathname, fallback }: { children: ReactNode; pathname: string; fallback: ReactNode }) {
    const [startedAt] = useState(() => performance.now());
    const owner = useUserStore((s) => s.user?.id);
    useLayoutEffect(() => {
        const currentLease = ++lease;
        if (activeOwner !== owner) {
            perceived?.stop();
            reportPerformance.clear();
            activeOwner = owner;
        }
        if (!PUBLIC_MODE || !owner) return;
        perceived ??= createPerceivedPerformance(reportPerformance, () => reportPerformance.flush(true));
        // Outside Suspense so first-screen paint and input during lazy loading count.
        perceived.start(pathname, startedAt);
        return () => {
            // React StrictMode and pathname remounts reuse one document observer.
            queueMicrotask(() => {
                if (lease !== currentLease) return;
                perceived?.stop();
                reportPerformance.clear();
                activeOwner = undefined;
            });
        };
    }, [owner, pathname, startedAt]);
    return <Suspense fallback={fallback}>{children}<RoutePerformance startedAt={startedAt} pathname={pathname} /></Suspense>;
}

/** Mounted inside Suspense: measures committed route UI, NOT completed image/data loading. */
export function RoutePerformance({ startedAt, pathname }: { startedAt: number; pathname: string }) {
    const owner = useUserStore((s) => s.user?.id);
    const attempted = useRef(false);
    useEffect(() => {
        if (attempted.current || !PUBLIC_MODE || !owner || document.visibilityState !== "visible") return;
        let canceled = false;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (canceled || attempted.current || document.visibilityState !== "visible" || useUserStore.getState().user?.id !== owner) return;
                attempted.current = true;
                const route = performanceRoute(pathname);
                const samples: PerformanceSample[] = [{ route, name: "route_ready", durationMs: performance.now() - startedAt }];
                if (!documentReported) {
                    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
                    if (navigation?.domContentLoadedEventEnd) {
                        // Document timings belong to the document's initial route, even if
                        // its first reporting opportunity was canceled or rate-limited.
                        const documentRoute = performanceRoute(new URL(navigation.name).pathname);
                        samples.push({ route: documentRoute, name: "document_ready", durationMs: navigation.domContentLoadedEventEnd - navigation.startTime });
                        samples.push({ route: documentRoute, name: "ttfb", durationMs: navigation.responseStart - navigation.startTime });
                    }
                }
                if (reportPerformance(samples) && samples.some((sample) => sample.name === "document_ready")) documentReported = true;
            });
        });
        return () => { canceled = true; cancelAnimationFrame(frame); };
    }, [owner, pathname, startedAt]);
    return null;
}

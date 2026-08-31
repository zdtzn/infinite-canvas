export const routeLoaders = {
    "/": () => import("@/pages/home"),
    "/canvas": () => import("@/pages/canvas"),
    "/canvas/:id": () => import("@/pages/canvas/project"),
    "/chat": async () => {
        const [page, bootstrap] = await Promise.all([import("@/pages/chat"), import("@/services/chat-bootstrap-cache")]);
        bootstrap.prefetchChatBootstrapForCurrentUser();
        return page;
    },
    "/color-alchemy": () => import("@/pages/color-alchemy"),
    "/config": () => import("@/pages/config"),
    "/cultivation": () => import("@/pages/cultivation"),
    "/docs": () => import("@/pages/docs"),
    "/admin/cultivation": () => import("@/pages/admin/cultivation"),
    "/image": () => import("@/pages/image"),
    "/product-lab": () => import("@/pages/product-lab"),
    "/prompts": () => import("@/pages/prompts"),
    "/assets": () => import("@/pages/assets"),
    "/video": () => import("@/pages/video"),
} as const;

const pendingRouteLoads = new Map<string, Promise<void>>();
const loadedRouteKeys = new Set<string>();
const activeWarmupStops = new Set<() => void>();

type PreloadRouteOptions = {
    fromWarmup?: boolean;
};

type RouteWarmupTarget = {
    route: keyof typeof routeLoaders;
    delayMs: number;
    idleTimeoutMs?: number;
};

// Compact and frequently used workspaces go first. Wider creation graphs are
// intentionally delayed so their module evaluation cannot block an immediate
// user navigation during application startup.
const routeWarmupTargets: readonly RouteWarmupTarget[] = [
    { route: "/chat", delayMs: 2_400, idleTimeoutMs: 1_500 },
    { route: "/canvas", delayMs: 1_200 },
    { route: "/assets", delayMs: 1_200 },
    { route: "/prompts", delayMs: 1_500 },
    { route: "/cultivation", delayMs: 1_500 },
    { route: "/image", delayMs: 1_800 },
    { route: "/color-alchemy", delayMs: 1_800 },
    { route: "/product-lab", delayMs: 1_800 },
    { route: "/video", delayMs: 1_800 },
];

export function buildRouteWarmupOrder(currentPath: string) {
    const currentRouteKey = routeKeyForPath(currentPath);
    return routeWarmupTargets.filter((target) => target.route !== currentRouteKey);
}

export function preloadRoute(path: string, options: PreloadRouteOptions = {}) {
    const routeKey = routeKeyForPath(path);
    if (!isRouteKey(routeKey)) return Promise.resolve();
    if (!options.fromWarmup) stopActiveWarmups();
    const loader = routeLoaders[routeKey];

    if (loadedRouteKeys.has(routeKey)) return Promise.resolve();

    const existing = pendingRouteLoads.get(routeKey);
    if (existing) return existing;

    const pending = loader()
        .then(() => {
            loadedRouteKeys.add(routeKey);
        })
        .catch(() => undefined)
        .finally(() => pendingRouteLoads.delete(routeKey));
    pendingRouteLoads.set(routeKey, pending);
    return pending;
}

export function warmupRoutesWhenIdle(currentPath: string) {
    if (typeof window === "undefined") return () => undefined;

    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g" || connection?.effectiveType === "3g") return () => undefined;

    const targets = buildRouteWarmupOrder(currentPath);
    let index = 0;
    let stopped = false;
    let loading = false;
    let blockedUntil = 0;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
    };
    const scheduling = (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling;

    const clearScheduledWork = () => {
        if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
        if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
        idleHandle = undefined;
        timeoutHandle = undefined;
    };

    const scheduleNext = (overrideDelayMs?: number) => {
        clearScheduledWork();
        if (stopped || index >= targets.length) {
            if (index >= targets.length) stopWarmup();
            return;
        }
        const target = targets[index];
        const activityDelay = Math.max(0, blockedUntil - performance.now());
        const delayMs = Math.max(overrideDelayMs ?? target.delayMs, activityDelay);
        timeoutHandle = window.setTimeout(() => {
            timeoutHandle = undefined;
            if (stopped || index >= targets.length || document.hidden) return;
            if (idleWindow.requestIdleCallback) {
                idleHandle = idleWindow.requestIdleCallback(runNext, target.idleTimeoutMs ? { timeout: target.idleTimeoutMs } : undefined);
            } else {
                runNext();
            }
        }, delayMs);
    };

    const runNext = (deadline?: IdleDeadlineLike) => {
        idleHandle = undefined;
        if (stopped || loading || index >= targets.length) return;
        if (document.hidden || performance.now() < blockedUntil || scheduling?.isInputPending?.() || (deadline && !deadline.didTimeout && deadline.timeRemaining() < 8)) {
            scheduleNext(500);
            return;
        }
        const target = targets[index++];
        loading = true;
        void preloadRoute(target.route, { fromWarmup: true }).finally(() => {
            loading = false;
            scheduleNext();
        });
    };

    const handleUserActivity = () => {
        if (stopped) return;
        blockedUntil = performance.now() + 1_200;
        if (!loading) scheduleNext(1_200);
    };

    const handleVisibilityChange = () => {
        if (document.hidden) clearScheduledWork();
        else {
            blockedUntil = performance.now() + 300;
            if (!loading) scheduleNext(300);
        }
    };

    function stopWarmup() {
        if (stopped) return;
        stopped = true;
        activeWarmupStops.delete(stopWarmup);
        clearScheduledWork();
        window.removeEventListener("pointerdown", handleUserActivity, true);
        window.removeEventListener("keydown", handleUserActivity, true);
        window.removeEventListener("wheel", handleUserActivity, true);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    window.addEventListener("pointerdown", handleUserActivity, { capture: true, passive: true });
    window.addEventListener("keydown", handleUserActivity, { capture: true });
    window.addEventListener("wheel", handleUserActivity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    activeWarmupStops.add(stopWarmup);
    scheduleNext();

    return stopWarmup;
}

function stopActiveWarmups() {
    [...activeWarmupStops].forEach((stop) => stop());
}

function routeKeyForPath(path: string) {
    const pathname = path.split(/[?#]/, 1)[0] || "/";
    if (/^\/canvas\/[^/]+$/.test(pathname)) return "/canvas/:id";
    return pathname;
}

function isRouteKey(path: string): path is keyof typeof routeLoaders {
    return Object.prototype.hasOwnProperty.call(routeLoaders, path);
}

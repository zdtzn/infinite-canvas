export const routeLoaders = {
    "/": () => import("@/pages/home"),
    "/canvas": () => import("@/pages/canvas"),
    "/canvas/:id": () => import("@/pages/canvas/project"),
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

const routeWarmupOrder = ["/image", "/canvas", "/assets", "/color-alchemy", "/product-lab", "/prompts", "/video", "/cultivation", "/config", "/", "/docs", "/canvas/:id"] as const;

export function preloadRoute(path: string) {
    const routeKey = routeKeyForPath(path);
    if (!isRouteKey(routeKey)) return Promise.resolve();
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
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return () => undefined;

    const currentRouteKey = routeKeyForPath(currentPath);
    const prioritizedRoutes: string[] = [...routeWarmupOrder];
    const currentIndex = prioritizedRoutes.indexOf(currentRouteKey);
    if (currentIndex >= 0) {
        const adjacentRoutes = [prioritizedRoutes[currentIndex + 1], prioritizedRoutes[currentIndex - 1]].filter((route): route is string => Boolean(route));
        prioritizedRoutes.unshift(...adjacentRoutes);
    }
    const routes = [...new Set(prioritizedRoutes)].filter((route) => route !== currentRouteKey);
    let index = 0;
    let stopped = false;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
    };

    const scheduleNext = (initial = false) => {
        if (stopped || index >= routes.length) return;
        if (initial) {
            timeoutHandle = window.setTimeout(runNext, 200);
            return;
        }
        if (idleWindow.requestIdleCallback) {
            idleHandle = idleWindow.requestIdleCallback(runNext, { timeout: 700 });
        } else {
            timeoutHandle = window.setTimeout(runNext, 200);
        }
    };

    const runNext = () => {
        idleHandle = undefined;
        timeoutHandle = undefined;
        if (stopped || index >= routes.length) return;
        const route = routes[index++];
        void preloadRoute(route).finally(scheduleNext);
    };

    scheduleNext(true);

    return () => {
        stopped = true;
        if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
        if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
}

function routeKeyForPath(path: string) {
    const pathname = path.split(/[?#]/, 1)[0] || "/";
    if (/^\/canvas\/[^/]+$/.test(pathname)) return "/canvas/:id";
    return pathname;
}

function isRouteKey(path: string): path is keyof typeof routeLoaders {
    return Object.prototype.hasOwnProperty.call(routeLoaders, path);
}

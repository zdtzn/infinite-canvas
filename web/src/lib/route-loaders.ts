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

export function preloadRoute(path: string) {
    const routeKey = routeKeyForPath(path);
    if (!isRouteKey(routeKey)) return Promise.resolve();
    const loader = routeLoaders[routeKey];

    const existing = pendingRouteLoads.get(routeKey);
    if (existing) return existing;

    const pending = loader()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => pendingRouteLoads.delete(routeKey));
    pendingRouteLoads.set(routeKey, pending);
    return pending;
}

function routeKeyForPath(path: string) {
    const pathname = path.split(/[?#]/, 1)[0] || "/";
    if (/^\/canvas\/[^/]+$/.test(pathname)) return "/canvas/:id";
    return pathname;
}

function isRouteKey(path: string): path is keyof typeof routeLoaders {
    return Object.prototype.hasOwnProperty.call(routeLoaders, path);
}

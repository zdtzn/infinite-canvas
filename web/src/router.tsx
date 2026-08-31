import { Suspense, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { createBrowserRouter, Outlet, useLocation } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { lazyRoute } from "@/lib/lazy-route";
import { routeLoaders } from "@/lib/route-loaders";
import UserLayout from "@/layouts/user-layout";
import RouteErrorPage from "@/pages/route-error";
const AssetsPage = lazyRoute(routeLoaders["/assets"]);
const AnnouncementsPage = lazyRoute(routeLoaders["/announcements"]);
const CanvasPage = lazyRoute(routeLoaders["/canvas"]);
const CanvasProjectPage = lazyRoute(routeLoaders["/canvas/:id"]);
const ChatPage = lazyRoute(routeLoaders["/chat"]);
const ColorAlchemyPage = lazyRoute(routeLoaders["/color-alchemy"]);
const ConfigPage = lazyRoute(routeLoaders["/config"]);
const CultivationPage = lazyRoute(routeLoaders["/cultivation"]);
const DocsPage = lazyRoute(routeLoaders["/docs"]);
const AdminCultivationPage = lazyRoute(routeLoaders["/admin/cultivation"]);
const HomePage = lazyRoute(routeLoaders["/"]);
const ImagePage = lazyRoute(routeLoaders["/image"]);
const ProductLabPage = lazyRoute(routeLoaders["/product-lab"]);
const NotFound = lazyRoute(() => import("@/pages/not-found"));
const PromptsPage = lazyRoute(routeLoaders["/prompts"]);
const VideoPage = lazyRoute(routeLoaders["/video"]);

function RoutePage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

function RouteLoading() {
    const label = useImperialLoadingText("正在加载...", "route");
    const { pathname } = useLocation();
    if (pathname === "/image") return <ImageRouteLoading label={label} />;
    const meta = routeLoadingMeta(pathname);
    if (meta) return <WorkspaceRouteLoading label={label} {...meta} />;
    return <div className="imperial-route-loading grid h-full place-items-center text-sm text-stone-500">{label}</div>;
}

function routeLoadingMeta(pathname: string) {
    if (/^\/canvas\/[^/]+$/.test(pathname)) return { eyebrow: "INFINITE CANVAS", title: "无限画布", split: false };
    return {
        "/canvas": { eyebrow: "DONG TIAN", title: "洞天", split: false },
        "/chat": { eyebrow: "WEN DAO TAI", title: "问道台", split: true },
        "/color-alchemy": { eyebrow: "LING CAI", title: "灵彩", split: true },
        "/product-lab": { eyebrow: "SHANG PIN HUAN JING", title: "商品幻境", split: true },
        "/video": { eyebrow: "LIU GUANG GE", title: "流光阁", split: true },
        "/assets": { eyebrow: "CANG JUAN GE", title: "藏卷阁", split: false },
        "/announcements": { eyebrow: "SYSTEM NOTICE", title: "系统公告", split: false },
        "/prompts": { eyebrow: "GONG FA LOU", title: "功法楼", split: false },
        "/cultivation": { eyebrow: "MING GONG", title: "命宫", split: false },
        "/config": { eyebrow: "DONG FU", title: "洞府", split: false },
        "/docs": { eyebrow: "DOCUMENTATION", title: "使用文档", split: false },
        "/admin/cultivation": { eyebrow: "ZHANG JIAO DIAN", title: "掌教殿", split: false },
    }[pathname];
}

function WorkspaceRouteLoading({ eyebrow, title, label, split }: { eyebrow: string; title: string; label: string; split: boolean }) {
    return (
        <div className="imperial-route-loading h-full overflow-hidden bg-background p-3 text-foreground" aria-busy="true" aria-live="polite">
            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800">
                <div className="border-b border-stone-200 bg-[#101117] px-5 py-4 dark:border-stone-800">
                    <p className="text-[10px] text-[#c9a86a]">{eyebrow}</p>
                    <h1 className="font-brush mt-1 text-3xl text-[#edede6]">{title}</h1>
                </div>
                <div className={split ? "grid min-h-0 flex-1 gap-3 p-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]" : "min-h-0 flex-1 p-4"} aria-hidden="true">
                    <div className="space-y-4">
                        <div className="h-9 w-full animate-pulse rounded bg-stone-100 dark:bg-stone-900" />
                        <div className="h-28 w-full animate-pulse rounded bg-stone-100 dark:bg-stone-900" />
                        <div className="h-20 w-full animate-pulse rounded bg-stone-100 dark:bg-stone-900" />
                    </div>
                    {split ? (
                        <div className="hidden min-h-0 animate-pulse rounded border border-dashed border-stone-300 bg-stone-50 lg:block dark:border-stone-700 dark:bg-stone-900/60" />
                    ) : (
                        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {Array.from({ length: 8 }, (_, index) => (
                                <div key={index} className="aspect-[4/3] animate-pulse rounded bg-stone-100 dark:bg-stone-900" />
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex h-10 shrink-0 items-center justify-center border-t border-stone-200 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">{label}</div>
            </section>
        </div>
    );
}

function ImageRouteLoading({ label }: { label: string }) {
    return (
        <div className="h-full overflow-hidden bg-background p-3 text-foreground" aria-busy="true" aria-live="polite">
            <section className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
                <div className="min-h-0 rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:p-5">
                    <div className="rounded-lg bg-[#101117] p-5">
                        <p className="text-[10px] tracking-[0.4em] text-[#c9a86a]">DAN QING TAI</p>
                        <h1 className="font-brush mt-2 text-4xl text-[#edede6]">丹青台</h1>
                    </div>
                    <div className="mt-6 space-y-5" aria-hidden="true">
                        <div className="h-5 w-20 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
                        <div className="h-32 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />
                        <div className="h-28 animate-pulse rounded-lg border border-dashed border-stone-300 dark:border-stone-700" />
                        <div className="h-9 animate-pulse rounded bg-stone-100 dark:bg-stone-900" />
                    </div>
                </div>
                <div className="grid min-h-0 place-items-center rounded-lg border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                    <div className="flex flex-col items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                        <LoaderCircle className="size-5 animate-spin" />
                        <span>{label}</span>
                    </div>
                </div>
            </section>
        </div>
    );
}

export const router = createBrowserRouter([
    {
        errorElement: <RouteErrorPage />,
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            {
                path: "/",
                element: (
                    <RoutePage>
                        <HomePage />
                    </RoutePage>
                ),
            },
            {
                path: "/color-alchemy",
                element: (
                    <RoutePage>
                        <ColorAlchemyPage />
                    </RoutePage>
                ),
            },
            {
                path: "/announcements",
                element: (
                    <RoutePage>
                        <AnnouncementsPage />
                    </RoutePage>
                ),
            },
            {
                path: "/image",
                element: (
                    <RoutePage>
                        <ImagePage />
                    </RoutePage>
                ),
            },
            {
                path: "/chat",
                element: (
                    <RoutePage>
                        <ChatPage />
                    </RoutePage>
                ),
            },
            {
                path: "/product-lab",
                element: (
                    <RoutePage>
                        <ProductLabPage />
                    </RoutePage>
                ),
            },
            {
                path: "/video",
                element: (
                    <RoutePage>
                        <VideoPage />
                    </RoutePage>
                ),
            },
            {
                path: "/assets",
                element: (
                    <RoutePage>
                        <AssetsPage />
                    </RoutePage>
                ),
            },
            {
                path: "/prompts",
                element: (
                    <RoutePage>
                        <PromptsPage />
                    </RoutePage>
                ),
            },
            {
                path: "/canvas",
                element: (
                    <RoutePage>
                        <CanvasPage />
                    </RoutePage>
                ),
            },
            {
                path: "/canvas/:id",
                element: (
                    <RoutePage>
                        <CanvasProjectPage />
                    </RoutePage>
                ),
            },
            {
                path: "/docs",
                element: (
                    <RoutePage>
                        <DocsPage />
                    </RoutePage>
                ),
            },
            {
                path: "/config",
                element: (
                    <RoutePage>
                        <ConfigPage />
                    </RoutePage>
                ),
            },
            {
                path: "/cultivation",
                element: (
                    <RoutePage>
                        <CultivationPage />
                    </RoutePage>
                ),
            },
            {
                path: "/admin/cultivation",
                element: (
                    <RoutePage>
                        <AdminCultivationPage />
                    </RoutePage>
                ),
            },
        ],
    },
    {
        path: "*",
        errorElement: <RouteErrorPage />,
        element: (
            <RoutePage>
                <NotFound />
            </RoutePage>
        ),
    },
]);

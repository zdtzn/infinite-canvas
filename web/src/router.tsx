import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { lazyRoute } from "@/lib/lazy-route";
import UserLayout from "@/layouts/user-layout";
import RouteErrorPage from "@/pages/route-error";
const AssetsPage = lazyRoute(() => import("@/pages/assets"));
const CanvasPage = lazyRoute(() => import("@/pages/canvas"));
const CanvasProjectPage = lazyRoute(() => import("@/pages/canvas/project"));
const ColorAlchemyPage = lazyRoute(() => import("@/pages/color-alchemy"));
const ConfigPage = lazyRoute(() => import("@/pages/config"));
const CultivationPage = lazyRoute(() => import("@/pages/cultivation"));
const DocsPage = lazyRoute(() => import("@/pages/docs"));
const AdminCultivationPage = lazyRoute(() => import("@/pages/admin/cultivation"));
const HomePage = lazyRoute(() => import("@/pages/home"));
const ImagePage = lazyRoute(() => import("@/pages/image"));
const ProductLabPage = lazyRoute(() => import("@/pages/product-lab"));
const NotFound = lazyRoute(() => import("@/pages/not-found"));
const PromptsPage = lazyRoute(() => import("@/pages/prompts"));
const VideoPage = lazyRoute(() => import("@/pages/video"));

function RoutePage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

function RouteLoading() {
    const label = useImperialLoadingText("正在加载...", "route");
    return <div className="imperial-route-loading grid h-full place-items-center text-sm text-stone-500">{label}</div>;
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
                path: "/image",
                element: (
                    <RoutePage>
                        <ImagePage />
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

import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import UserLayout from "@/layouts/user-layout";
const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const CultivationPage = lazy(() => import("@/pages/cultivation"));
const AdminCultivationPage = lazy(() => import("@/pages/admin/cultivation"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function RoutePage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

function RouteLoading() {
    const label = useImperialLoadingText("正在加载...", "route");
    return <div className="imperial-route-loading grid h-full place-items-center text-sm text-stone-500">{label}</div>;
}

export const router = createBrowserRouter([
    {
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
                path: "/image",
                element: (
                    <RoutePage>
                        <ImagePage />
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
        element: (
            <RoutePage>
                <NotFound />
            </RoutePage>
        ),
    },
]);

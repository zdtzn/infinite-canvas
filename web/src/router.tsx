import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function RoutePage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<div className="grid h-full place-items-center text-sm text-stone-500">正在加载...</div>}>{children}</Suspense>;
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
            { path: "/", element: <RoutePage><HomePage /></RoutePage> },
            { path: "/image", element: <RoutePage><ImagePage /></RoutePage> },
            { path: "/video", element: <RoutePage><VideoPage /></RoutePage> },
            { path: "/assets", element: <RoutePage><AssetsPage /></RoutePage> },
            { path: "/prompts", element: <RoutePage><PromptsPage /></RoutePage> },
            { path: "/canvas", element: <RoutePage><CanvasPage /></RoutePage> },
            { path: "/canvas/:id", element: <RoutePage><CanvasProjectPage /></RoutePage> },
            { path: "/config", element: <RoutePage><ConfigPage /></RoutePage> },
        ],
    },
    { path: "*", element: <RoutePage><NotFound /></RoutePage> },
]);

import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { lazyRoute } from "@/lib/lazy-route";
import { routeLoaders } from "@/lib/route-loaders";
import UserLayout from "@/layouts/user-layout";
import RouteErrorPage from "@/pages/route-error";
const AssetsPage = lazyRoute(routeLoaders["/assets"]);
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

import { Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { useDeferredMount } from "@/hooks/use-deferred-mount";
import { lazyRoute } from "@/lib/lazy-route";
import { warmupRoutesWhenIdle } from "@/lib/route-loaders";
import { cn } from "@/lib/utils";

const AgentPanelHost = lazyRoute(() => import("@/components/layout/agent-runtime").then(({ AgentPanelHost: Component }) => ({ default: Component })));
const SplashCursor = lazyRoute(() => import("@/components/effects/splash-cursor"));
const CultivationBreakthroughOverlay = lazyRoute(() => import("@/features/cultivation/breakthrough-overlay").then(({ CultivationBreakthroughOverlay: Component }) => ({ default: Component })));
const ImperialWelcome = lazyRoute(() => import("@/features/cultivation/imperial-welcome").then(({ ImperialWelcome: Component }) => ({ default: Component })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { isDouEmperor, isImperialMode, imperialWelcomeEnabled } = useImperialMode();
    const { pathname } = useLocation();
    const visualEffectsReady = useDeferredMount(650);

    useEffect(() => warmupRoutesWhenIdle(pathname), [pathname]);

    return (
        <div className={cn("imperial-app-shell flex h-dvh overflow-hidden bg-background text-foreground", isImperialMode && "is-imperial")}>
            {visualEffectsReady ? (
                <Suspense fallback={null}>
                    <SplashCursor
                        SIM_RESOLUTION={96}
                        DYE_RESOLUTION={640}
                        DENSITY_DISSIPATION={4}
                        VELOCITY_DISSIPATION={2.2}
                        PRESSURE_ITERATIONS={12}
                        CURL={4}
                        SPLAT_RADIUS={0.025}
                        SPLAT_FORCE={4000}
                        RAINBOW_MODE
                        className={cn(pathname.startsWith("/canvas/") && "is-canvas-workspace")}
                    />
                </Suspense>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {visualEffectsReady ? (
                <Suspense fallback={null}>
                    <AgentPanelHost />
                </Suspense>
            ) : null}
            {visualEffectsReady ? (
                <Suspense fallback={null}>
                    <CultivationBreakthroughOverlay />
                    {isDouEmperor && imperialWelcomeEnabled ? <ImperialWelcome /> : null}
                </Suspense>
            ) : null}
        </div>
    );
}

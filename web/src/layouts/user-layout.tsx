import { Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { SplashCursor } from "@/components/effects/splash-cursor";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { CultivationBreakthroughOverlay } from "@/features/cultivation/breakthrough-overlay";
import { ImperialWelcome, useImperialMode } from "@/features/cultivation/imperial-mode";
import { lazyRoute } from "@/lib/lazy-route";
import { warmupRoutesWhenIdle } from "@/lib/route-loaders";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazyRoute(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const { isImperialMode } = useImperialMode();
    const { pathname } = useLocation();

    useEffect(() => warmupRoutesWhenIdle(pathname), [pathname]);

    return (
        <div className={cn("imperial-app-shell flex h-dvh overflow-hidden bg-background text-foreground", isImperialMode && "is-imperial")}>
            <SplashCursor
                SIM_RESOLUTION={96}
                DYE_RESOLUTION={640}
                DENSITY_DISSIPATION={4}
                VELOCITY_DISSIPATION={2.2}
                PRESSURE_ITERATIONS={12}
                CURL={4}
                SPLAT_RADIUS={0.04}
                SPLAT_FORCE={4000}
                RAINBOW_MODE={!isImperialMode}
                COLOR="#ebba20"
                className={cn(pathname.startsWith("/canvas/") && "is-canvas-workspace", isImperialMode && "is-imperial")}
            />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {agentPanelOpen ? (
                <Suspense fallback={null}>
                    <AgentPanel />
                </Suspense>
            ) : null}
            <CultivationBreakthroughOverlay />
            <ImperialWelcome />
        </div>
    );
}

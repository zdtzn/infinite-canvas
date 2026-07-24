import { lazy, Suspense, type ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { CultivationBreakthroughOverlay } from "@/features/cultivation/breakthrough-overlay";
import { ImperialWelcome, useImperialMode } from "@/features/cultivation/imperial-mode";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const { isImperialMode } = useImperialMode();

    return (
        <div className={cn("imperial-app-shell flex h-dvh overflow-hidden bg-background text-foreground", isImperialMode && "is-imperial")}>
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

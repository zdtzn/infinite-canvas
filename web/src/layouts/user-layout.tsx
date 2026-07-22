import { lazy, Suspense, type ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { CultivationBreakthroughOverlay } from "@/features/cultivation/breakthrough-overlay";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {agentPanelOpen ? <Suspense fallback={null}><AgentPanel /></Suspense> : null}
            <CultivationBreakthroughOverlay />
        </div>
    );
}

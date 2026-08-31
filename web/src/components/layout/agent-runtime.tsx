import { Bot } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Suspense, useEffect, useRef } from "react";

import { lazyRoute } from "@/lib/lazy-route";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazyRoute(() => import("@/components/agent/agent-panel").then(({ AgentPanel: Component }) => ({ default: Component })));

export function AgentNavAction() {
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        let disposed = false;
        let idleHandle: number | undefined;
        const idleWindow = window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };
        const connect = () => {
            if (disposed || autoConnectRef.current || agentEnabled || agentConnected) return;
            autoConnectRef.current = true;
            setAgentState({ panelMounted: true, panelClosing: false });
            connectAgent({ silent: true });
        };
        const delayHandle = window.setTimeout(() => {
            if (idleWindow.requestIdleCallback) idleHandle = idleWindow.requestIdleCallback(connect, { timeout: 1_500 });
            else connect();
        }, 1_200);
        return () => {
            disposed = true;
            window.clearTimeout(delayHandle);
            if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
        };
    }, [agentConnected, agentEnabled, agentToken, connectAgent, setAgentState]);

    return (
        <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
        </Tooltip>
    );
}

export function AgentPanelHost() {
    const panelMounted = useAgentStore((state) => state.panelMounted);
    if (!panelMounted) return null;

    return (
        <Suspense fallback={null}>
            <AgentPanel />
        </Suspense>
    );
}

import { Bot } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { lazyRoute } from "@/lib/lazy-route";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazyRoute(() => import("@/components/agent/agent-panel").then(({ AgentPanel: Component }) => ({ default: Component })));

export function AgentNavAction() {
    const { hash } = useLocation();
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || fragmentBootstrap || hasAgentUrlBootstrap(hash) || !agentToken.trim()) return;
        let disposed = false;
        let idleHandle: number | undefined;
        const idleWindow = window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };
        const connect = () => {
            const agent = useAgentStore.getState();
            if (disposed || autoConnectRef.current || agent.enabled || agent.connected || agent.fragmentBootstrap || hasAgentUrlBootstrap(window.location.hash)) return;
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
    }, [agentConnected, agentEnabled, agentToken, connectAgent, fragmentBootstrap, hash, setAgentState]);

    return (
        <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
        </Tooltip>
    );
}

export function AgentPanelHost() {
    const { hash, pathname } = useLocation();
    const panelMounted = useAgentStore((state) => state.panelMounted);
    useLayoutEffect(() => {
        if (!matchPath("/canvas/:id", pathname) || !hasAgentUrlBootstrap(hash)) return;
        useAgentStore.setState({ panelMounted: true, panelClosing: false });
    }, [hash, pathname]);
    if (!panelMounted) return null;

    return (
        <Suspense fallback={null}>
            <AgentPanel />
        </Suspense>
    );
}

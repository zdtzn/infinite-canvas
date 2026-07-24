import { Bot, ChevronDown, Menu } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { primaryNavigationTools, secondaryNavigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { TaskCenter } from "@/components/layout/task-center";
import { ImperialModeBadge } from "@/features/cultivation/imperial-mode";
import { CultivationStatusPill } from "@/features/cultivation/status-pill";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then(({ AppConfigModal: Component }) => ({ default: Component })));

function DeferredAppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    if (!isConfigOpen) return null;

    return (
        <Suspense
            fallback={
                <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/10 backdrop-blur-[1px]" aria-live="polite">
                    <span className="rounded-md border border-stone-200 bg-background px-3 py-2 text-sm text-stone-600 shadow-lg dark:border-stone-700 dark:text-stone-300">正在打开配置...</span>
                </div>
            }
        >
            <AppConfigModal />
        </Suspense>
    );
}

export function AppTopNav() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = [...primaryNavigationTools, ...secondaryNavigationTools].some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const secondaryActive = secondaryNavigationTools.some((tool) => tool.slug === activeToolSlug);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="app-logo-mark size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="text-base font-medium">无限画布</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="ml-6 hidden h-14 min-w-0 items-center gap-5 md:flex">
                                {primaryNavigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                                <Dropdown
                                    menu={{
                                        items: secondaryNavigationTools.map((tool) => {
                                            const Icon = tool.icon;
                                            return { key: tool.slug, icon: <Icon className="size-4" />, label: tool.label, onClick: () => navigate(`/${tool.slug}`) };
                                        }),
                                    }}
                                    trigger={["click"]}
                                >
                                    <button
                                        type="button"
                                        className={cn(
                                            "flex h-14 items-center gap-1 text-sm leading-6 transition",
                                            secondaryActive ? "font-medium text-stone-950 dark:text-stone-100" : "text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                        )}
                                        aria-label="打开更多导航"
                                    >
                                        更多
                                        <ChevronDown className="size-3.5" />
                                    </button>
                                </Dropdown>
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <span className="hidden lg:inline-flex">
                                <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
                                </Tooltip>
                            </span>
                            <ImperialModeBadge />
                            <CultivationStatusPill />
                            <TaskCenter />
                            <UserStatusActions showTaskCenter={false} />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <DeferredAppConfigModal />
        </>
    );
}

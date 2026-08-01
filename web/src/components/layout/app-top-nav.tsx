import { Bot, ChevronDown, Menu } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { navigationSceneNames, primaryNavigationTools, secondaryNavigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions, WorkspaceMenuAction } from "@/components/layout/user-status-actions";
import { TaskCenter } from "@/components/layout/task-center";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { CultivationStatusPill } from "@/features/cultivation/status-pill";
import { lazyRoute } from "@/lib/lazy-route";
import { cn } from "@/lib/utils";
import { Suspense, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazyRoute(() => import("@/components/layout/app-config-modal").then(({ AppConfigModal: Component }) => ({ default: Component })));

function DeferredAppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const loadingLabel = useImperialLoadingText("正在打开配置...", "config");
    if (!isConfigOpen) return null;

    return (
        <Suspense
            fallback={
                <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/10 backdrop-blur-[1px]" aria-live="polite">
                    <span className="rounded-md border border-stone-200 bg-background px-3 py-2 text-sm text-stone-600 shadow-lg dark:border-stone-700 dark:text-stone-300">{loadingLabel}</span>
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
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/92 backdrop-blur-xl dark:border-[rgb(237_237_230/0.1)]">
                    <div className="flex h-full items-center justify-between gap-4 px-4 lg:px-6">
                        <div className="flex min-w-0 items-center">
                            <button
                                type="button"
                                className="mr-1 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <Link to="/" className="group flex h-14 shrink-0 items-center gap-2.5 pr-4" aria-label="山门(首页)">
                                <span
                                    className="app-logo-mark size-6 shrink-0 bg-stone-700 transition-colors group-hover:bg-stone-950 dark:bg-[#c9c4b9] dark:group-hover:bg-[#f7f4ea]"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="font-display hidden text-base font-semibold tracking-[0.2em] text-stone-800 sm:inline dark:text-[#edede6]">无限画布</span>
                            </Link>

                            <nav className="hidden h-14 min-w-0 items-center gap-1 lg:flex" aria-label="场景导航">
                                {primaryNavigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            title={tool.label}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 px-3 text-sm font-medium tracking-normal transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
                                                active ? "font-semibold !text-stone-950 after:bg-[#c9a86a] dark:!text-[#f0ead8]" : "!text-stone-600 after:bg-transparent hover:!text-stone-950 dark:!text-[#c9c4b9] dark:hover:!text-[#f7f4ea]",
                                            )}
                                        >
                                            <Icon className={cn("size-4", active && "text-[#c9a86a]")} />
                                            <span>{navigationSceneNames[tool.slug]}</span>
                                        </Link>
                                    );
                                })}
                                <Dropdown
                                    menu={{
                                        items: secondaryNavigationTools.map((tool) => {
                                            const Icon = tool.icon;
                                            return {
                                                key: tool.slug,
                                                icon: <Icon className="size-4" />,
                                                label: (
                                                    <span className="inline-flex min-w-32 items-baseline justify-between gap-3">
                                                        <span>{tool.label}</span>
                                                        <span className="text-xs text-stone-400">{navigationSceneNames[tool.slug]}</span>
                                                    </span>
                                                ),
                                                onClick: () => navigate(`/${tool.slug}`),
                                            };
                                        }),
                                    }}
                                    trigger={["click"]}
                                >
                                    <button
                                        type="button"
                                        className={cn(
                                            "relative flex h-14 shrink-0 items-center gap-1.5 px-3 text-sm font-medium tracking-normal transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                                            secondaryActive ? "font-semibold !text-stone-950 after:bg-[#c9a86a] dark:!text-[#f0ead8]" : "!text-stone-600 after:bg-transparent hover:!text-stone-950 dark:!text-[#c9c4b9] dark:hover:!text-[#f7f4ea]",
                                        )}
                                        aria-label="打开更多导航"
                                    >
                                        {secondaryActive && activeToolSlug ? navigationSceneNames[activeToolSlug] : "更多"}
                                        <ChevronDown className="size-3.5" />
                                    </button>
                                </Dropdown>
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <TaskCenter />
                            <span className="hidden lg:inline-flex">
                                <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
                                </Tooltip>
                            </span>
                            <WorkspaceMenuAction />
                            <CultivationStatusPill />
                            <UserStatusActions showTaskCenter={false} showWorkspaceMenu={false} />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <DeferredAppConfigModal />
        </>
    );
}

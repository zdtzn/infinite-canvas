import { ChevronDown, LoaderCircle, Menu, MessageCircle } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { navigationSceneNames, primaryNavigationTools, secondaryNavigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AnnouncementBell } from "@/components/layout/announcement-bell";
import { UserStatusActions, WorkspaceMenuAction } from "@/components/layout/user-status-actions";
import { useDeferredMount } from "@/hooks/use-deferred-mount";
import { lazyRoute } from "@/lib/lazy-route";
import { preloadRoute } from "@/lib/route-loaders";
import { cn } from "@/lib/utils";
import { Suspense, useState } from "react";
import { useChatRuntimeStore } from "@/stores/use-chat-runtime-store";

const AgentNavAction = lazyRoute(() => import("@/components/layout/agent-runtime").then(({ AgentNavAction: Component }) => ({ default: Component })));
const CultivationStatusPill = lazyRoute(() => import("@/features/cultivation/status-pill").then(({ CultivationStatusPill: Component }) => ({ default: Component })));
const DeferredAppConfigModal = lazyRoute(() => import("@/components/layout/deferred-app-config-modal").then(({ DeferredAppConfigModal: Component }) => ({ default: Component })));
const MobileNavDrawer = lazyRoute(() => import("@/components/layout/mobile-nav-drawer").then(({ MobileNavDrawer: Component }) => ({ default: Component })));
const TaskCenter = lazyRoute(() => import("@/components/layout/task-center").then(({ TaskCenter: Component }) => ({ default: Component })));

function NavActionPlaceholder({ widthClass = "w-7" }: { widthClass?: string }) {
    return <span className={cn("inline-flex h-8 shrink-0", widthClass)} aria-hidden="true" />;
}

export function AppTopNav() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const deferredNavReady = useDeferredMount(900, 1_500);
    const chatPending = useChatRuntimeStore((state) => state.pending);
    const chatRuntimeStatus = useChatRuntimeStore((state) => state.status);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = [...primaryNavigationTools, ...secondaryNavigationTools].some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const secondaryActive = secondaryNavigationTools.some((tool) => tool.slug === activeToolSlug);
    const chatRuntimeLabel = chatRuntimeStatus === "stopping" ? "正在停止问道台回答" : chatRuntimeStatus === "starting" ? "正在连接问道台" : "问道台正在回答";

    return (
        <>
            {!hideHeader ? (
                <header className="app-top-nav sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/92 backdrop-blur-xl dark:border-[rgb(237_237_230/0.1)]">
                    <div className="flex h-full items-center justify-between gap-4 px-4 lg:px-6">
                        <div className="flex min-w-0 items-center">
                            <button
                                type="button"
                                className="app-top-nav-mobile-trigger mr-1 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <Link
                                to="/"
                                className="group flex h-14 shrink-0 items-center gap-2.5 pr-4"
                                aria-label="山门(首页)"
                                onPointerEnter={() => void preloadRoute("/")}
                                onFocus={() => void preloadRoute("/")}
                                onPointerDown={() => void preloadRoute("/")}
                                onTouchStart={() => void preloadRoute("/")}
                            >
                                <span
                                    className="app-logo-mark size-6 shrink-0 bg-stone-700 transition-colors group-hover:bg-stone-950 dark:bg-[#c9c4b9] dark:group-hover:bg-[#f7f4ea]"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="app-top-nav-brand-text font-display hidden text-base font-semibold tracking-[0.2em] text-stone-800 sm:inline dark:text-[#edede6]">无限画布</span>
                            </Link>

                            <nav className="app-top-nav-scenes hidden h-14 min-w-0 items-center gap-1 lg:flex" aria-label="场景导航">
                                {primaryNavigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            onPointerEnter={() => void preloadRoute(`/${tool.slug}`)}
                                            onFocus={() => void preloadRoute(`/${tool.slug}`)}
                                            onPointerDown={() => void preloadRoute(`/${tool.slug}`)}
                                            onTouchStart={() => void preloadRoute(`/${tool.slug}`)}
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
                                                    <span
                                                        className="inline-flex min-w-32 items-baseline justify-between gap-3"
                                                        onPointerEnter={() => void preloadRoute(`/${tool.slug}`)}
                                                        onFocus={() => void preloadRoute(`/${tool.slug}`)}
                                                        onPointerDown={() => void preloadRoute(`/${tool.slug}`)}
                                                        onTouchStart={() => void preloadRoute(`/${tool.slug}`)}
                                                    >
                                                        <span className="font-medium">{navigationSceneNames[tool.slug]}</span>
                                                        <span className="text-xs text-stone-400">{tool.label}</span>
                                                    </span>
                                                ),
                                                onMouseEnter: () => void preloadRoute(`/${tool.slug}`),
                                                onClick: () => {
                                                    void preloadRoute(`/${tool.slug}`);
                                                    navigate(`/${tool.slug}`);
                                                },
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
                            {deferredNavReady ? (
                                <Suspense fallback={<NavActionPlaceholder />}>
                                    <TaskCenter />
                                </Suspense>
                            ) : (
                                <NavActionPlaceholder />
                            )}
                            <AnnouncementBell />
                            {chatPending ? (
                                <Tooltip title={`${chatRuntimeLabel}，点击返回问道台`}>
                                    <Button
                                        type="text"
                                        className="!h-8 !w-8 !min-w-8"
                                        icon={chatRuntimeStatus === "stopping" ? <LoaderCircle className="size-4 animate-spin" /> : <MessageCircle className="size-4 text-amber-600" />}
                                        aria-label={chatRuntimeLabel}
                                        onClick={() => {
                                            void preloadRoute("/chat");
                                            navigate("/chat");
                                        }}
                                    />
                                </Tooltip>
                            ) : null}
                            <span className="hidden lg:inline-flex">
                                {deferredNavReady ? (
                                    <Suspense fallback={<NavActionPlaceholder widthClass="w-8" />}>
                                        <AgentNavAction />
                                    </Suspense>
                                ) : (
                                    <NavActionPlaceholder widthClass="w-8" />
                                )}
                            </span>
                            <WorkspaceMenuAction />
                            <span className="app-top-nav-cultivation-slot inline-flex h-8 w-8 shrink-0 items-center justify-center lg:w-36">
                                {deferredNavReady ? (
                                    <Suspense fallback={null}>
                                        <CultivationStatusPill />
                                    </Suspense>
                                ) : null}
                            </span>
                            <UserStatusActions showTaskCenter={false} showWorkspaceMenu={false} />
                        </div>
                    </div>
                </header>
            ) : null}

            {mobileNavOpen ? (
                <Suspense fallback={null}>
                    <MobileNavDrawer open activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
                </Suspense>
            ) : null}
            {deferredNavReady ? (
                <Suspense fallback={null}>
                    <DeferredAppConfigModal />
                </Suspense>
            ) : null}
        </>
    );
}

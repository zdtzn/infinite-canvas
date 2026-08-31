import { useQuery } from "@tanstack/react-query";
import { Tooltip } from "antd";
import { Bell } from "lucide-react";
import { Suspense, useRef, useState } from "react";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { lazyRoute } from "@/lib/lazy-route";
import { fetchAnnouncements } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

const loadAnnouncementCenter = () => import("@/pages/announcements").then(({ AnnouncementCenterDialog: Component }) => ({ default: Component }));
const AnnouncementCenterDialog = lazyRoute(loadAnnouncementCenter);
const preloadAnnouncementCenter = () => void loadAnnouncementCenter().catch(() => undefined);

export function AnnouncementBell() {
    const [open, setOpen] = useState(false);
    const [hasOpened, setHasOpened] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const userId = useUserStore((state) => state.user?.id);
    const { data } = useQuery({
        queryKey: ["announcements", "summary", userId],
        queryFn: () => fetchAnnouncements({ page: 1, pageSize: 1 }),
        enabled: PUBLIC_MODE && Boolean(userId),
        staleTime: 30_000,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
    });
    if (!PUBLIC_MODE || !userId) return null;
    const unreadCount = data?.unreadCount || 0;
    const label = unreadCount ? `系统公告，${unreadCount} 条未读` : "系统公告";

    return (
        <>
            <Tooltip title={label}>
                <button
                    ref={triggerRef}
                    type="button"
                    className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a86a] dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"
                    aria-label={label}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onPointerEnter={preloadAnnouncementCenter}
                    onFocus={preloadAnnouncementCenter}
                    onPointerDown={preloadAnnouncementCenter}
                    onClick={() => {
                        setHasOpened(true);
                        setOpen(true);
                    }}
                >
                    <Bell className="size-4" aria-hidden="true" />
                    {unreadCount ? (
                        <span className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-[#b84b3a] px-1 text-center text-[9px] font-semibold leading-[14px] text-white ring-2 ring-background" aria-hidden="true">
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                    ) : null}
                </button>
            </Tooltip>
            {hasOpened ? (
                <Suspense fallback={null}>
                    <AnnouncementCenterDialog open={open} onClose={() => setOpen(false)} onAfterClose={() => triggerRef.current?.focus()} />
                </Suspense>
            ) : null}
        </>
    );
}

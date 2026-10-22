import { useQuery } from "@tanstack/react-query";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { fetchAnnouncements } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

export function useUnreadAnnouncements(userId?: string, poll = true) {
    const activeUserId = useUserStore((state) => state.user?.id);
    const ownerId = userId ?? activeUserId ?? "";
    return useQuery({
        queryKey: ["announcements", "unread-summary", ownerId],
        queryFn: () => fetchAnnouncements({ page: 1, pageSize: 1, unreadOnly: true, sort: "newest" }, ownerId),
        enabled: PUBLIC_MODE && Boolean(ownerId) && ownerId === activeUserId,
        staleTime: 30_000,
        refetchInterval: poll ? 60_000 : false,
        refetchOnWindowFocus: true,
    });
}

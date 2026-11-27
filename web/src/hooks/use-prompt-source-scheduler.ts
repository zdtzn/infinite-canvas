import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { refreshAllSources } from "@/services/api/prompts";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useUserStore } from "@/stores/use-user-store";
import { PUBLIC_MODE } from "@/constant/runtime-config";

const CHECK_INTERVAL_MS = 60_000;

/** Periodically refetch all enabled prompt sources while the app is open, based on the global schedule. */
export function usePromptSourceScheduler() {
    const queryClient = useQueryClient();
    const admin = useUserStore((state) => Boolean(state.user?.admin));
    const intervalMinutes = usePromptSourceStore((state) => state.schedule.intervalMinutes);

    useEffect(() => {
        if (!intervalMinutes || (PUBLIC_MODE && !admin)) return;
        let running = false;
        let lastAttemptAt = 0;
        const tick = async () => {
            if (running) return;
            const { schedule, updateSchedule } = usePromptSourceStore.getState();
            const last = schedule.lastFetchedAt ? new Date(schedule.lastFetchedAt).getTime() : 0;
            const now = Date.now();
            if (now - Math.max(last, lastAttemptAt) < intervalMinutes * 60_000) return;
            lastAttemptAt = now;
            running = true;
            try {
                const { succeeded } = await refreshAllSources();
                if (succeeded) updateSchedule("lastFetchedAt", new Date().toISOString());
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
                    queryClient.invalidateQueries({ queryKey: ["prompt-source-statuses"] }),
                ]);
            } catch {
                // Keep the last successful time when the refresh request fails.
            } finally {
                running = false;
            }
        };
        void tick();
        const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [admin, intervalMinutes, queryClient]);
}

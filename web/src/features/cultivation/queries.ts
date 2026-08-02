import { useQuery } from "@tanstack/react-query";

import { fetchCultivationProfile } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUserStore } from "@/stores/use-user-store";

export const cultivationProfileQueryKey = ["cultivation", "profile"] as const;
export const cultivationProfileQueryKeyFor = (userId: string) => [...cultivationProfileQueryKey, userId] as const;

export function useCultivationProfile() {
    const userId = useUserStore((state) => state.user?.id || "");
    const queryUserId = userId || (PUBLIC_MODE ? "" : "local");
    return useQuery({
        queryKey: cultivationProfileQueryKeyFor(queryUserId),
        queryFn: () => fetchCultivationProfile().then((response) => response.profile),
        enabled: PUBLIC_MODE && Boolean(userId),
        staleTime: 15_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: false,
    });
}

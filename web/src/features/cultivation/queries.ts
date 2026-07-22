import { useQuery } from "@tanstack/react-query";

import { fetchCultivationProfile } from "@/services/server-api";

export const cultivationProfileQueryKey = ["cultivation", "profile"] as const;

export function useCultivationProfile() {
    return useQuery({
        queryKey: cultivationProfileQueryKey,
        queryFn: () => fetchCultivationProfile().then((response) => response.profile),
        staleTime: 15_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: false,
    });
}

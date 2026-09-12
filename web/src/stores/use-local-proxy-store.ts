import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export function normalizeLocalProxyUrl(value: string): string {
    try {
        const url = new URL(value.trim());
        if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "";
        if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return "";
        return url.origin;
    } catch {
        return "";
    }
}

type LocalProxyStore = {
    enabled: boolean;
    url: string;
    setEnabled: (enabled: boolean) => void;
    setUrl: (url: string) => void;
};

export const useLocalProxyStore = create<LocalProxyStore>()(
    persist(
        (set) => ({
            enabled: false,
            url: "http://127.0.0.1:8789",
            setEnabled: (enabled) => set({ enabled }),
            setUrl: (url) => set({ url }),
        }),
        { name: "infinite-canvas:local-proxy", storage: createJSONStorage(() => localStorage), partialize: ({ enabled, url }) => ({ enabled, url }) },
    ),
);

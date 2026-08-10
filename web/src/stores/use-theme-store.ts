import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    canvasBackdropEnabled: boolean;
    setTheme: (theme: ThemeName) => void;
    setCanvasBackdropEnabled: (enabled: boolean) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            canvasBackdropEnabled: true,
            setTheme: (theme) => set({ theme }),
            setCanvasBackdropEnabled: (canvasBackdropEnabled) => set({ canvasBackdropEnabled }),
        }),
        {
            name: "infinite-canvas:theme_store",
            version: 2,
            migrate: (persistedState) => {
                const state = persistedState as Partial<ThemeStore>;
                return {
                    ...(persistedState as ThemeStore),
                    theme: state.theme === "light" ? "light" : "dark",
                    canvasBackdropEnabled: state.canvasBackdropEnabled !== false,
                };
            },
        },
    ),
);

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { AuthGate } from "@/components/layout/auth-gate";
import { imperialModeChangeEvent, ImperialModeProvider } from "@/features/cultivation/imperial-mode";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => failureCount < 2 && !/鉴权|口令|权限|参数|格式/.test(error instanceof Error ? error.message : ""),
            retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const [imperialModeActive, setImperialModeActive] = useState(false);
    const dark = theme === "dark" || imperialModeActive;

    useEffect(() => {
        const syncImperialMode = () => setImperialModeActive(document.documentElement.dataset.imperialMode === "true");
        syncImperialMode();
        window.addEventListener(imperialModeChangeEvent, syncImperialMode);
        return () => window.removeEventListener(imperialModeChangeEvent, syncImperialMode);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }, [dark]);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <App>
                <QueryClientProvider client={queryClient}>
                    <AuthGate>
                        <ImperialModeProvider>
                            <ClientRootInit>{children}</ClientRootInit>
                        </ImperialModeProvider>
                    </AuthGate>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}

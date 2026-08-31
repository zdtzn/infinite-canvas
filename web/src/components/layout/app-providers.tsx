import type { ReactNode } from "react";
import { Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AuthGate } from "@/components/layout/auth-gate";
import { AccountSessionController } from "@/components/layout/account-session-controller";
import { imperialModeChangeEvent, ImperialModeProvider } from "@/features/cultivation/imperial-mode";
import { getAntThemeConfig } from "@/lib/app-theme";
import { lazyRoute } from "@/lib/lazy-route";
import { useThemeStore } from "@/stores/use-theme-store";

const ClientRootInit = lazyRoute(() => import("@/components/layout/client-root-init").then(({ ClientRootInit: Component }) => ({ default: Component })));

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
                    <AccountSessionController>
                        <AuthGate>
                            <ImperialModeProvider>
                                <Suspense fallback={null}>
                                    <ClientRootInit />
                                </Suspense>
                                {children}
                            </ImperialModeProvider>
                        </AuthGate>
                    </AccountSessionController>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}

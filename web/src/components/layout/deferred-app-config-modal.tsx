import { Suspense } from "react";

import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { lazyRoute } from "@/lib/lazy-route";
import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazyRoute(() => import("@/components/layout/app-config-modal").then(({ AppConfigModal: Component }) => ({ default: Component })));

export function DeferredAppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const loadingLabel = useImperialLoadingText("正在打开配置...", "config");
    if (!isConfigOpen) return null;

    return (
        <Suspense
            fallback={
                <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/10 backdrop-blur-[1px]" aria-live="polite">
                    <span className="rounded-md border border-stone-200 bg-background px-3 py-2 text-sm text-stone-600 shadow-lg dark:border-stone-700 dark:text-stone-300">{loadingLabel}</span>
                </div>
            }
        >
            <AppConfigModal />
        </Suspense>
    );
}

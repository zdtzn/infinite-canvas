import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { attemptChunkRecovery } from "@/lib/lazy-route";
import { useUserStore } from "@/stores/use-user-store";

type AccountSessionRuntime = typeof import("./account-session-runtime");

let accountSessionRuntimePromise: Promise<AccountSessionRuntime> | null = null;

export function preloadAccountSessionRuntime() {
    if (!accountSessionRuntimePromise) {
        accountSessionRuntimePromise = import("./account-session-runtime").catch((error) => {
            accountSessionRuntimePromise = null;
            if (attemptChunkRecovery(error)) return new Promise<AccountSessionRuntime>(() => undefined);
            throw error;
        });
    }
    return accountSessionRuntimePromise;
}

export function AccountSessionController({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id || "");
    const previousUserId = useRef<string | null>(null);
    const lastAttemptKey = useRef("");
    const [readyUserId, setReadyUserId] = useState("");
    const [preparationError, setPreparationError] = useState("");
    const [retryVersion, setRetryVersion] = useState(0);

    useLayoutEffect(() => {
        const attemptKey = `${userId}:${retryVersion}`;
        if (lastAttemptKey.current === attemptKey) return;
        lastAttemptKey.current = attemptKey;
        const previous = previousUserId.current;
        if (previous === null && !userId) return;
        previousUserId.current = userId;
        setPreparationError("");
        if (userId) setReadyUserId("");

        if (previous !== null) {
            void queryClient.cancelQueries();
            queryClient.clear();
        }

        let active = true;
        void preloadAccountSessionRuntime()
            .then(({ prepareAccountSession }) => {
                if (!active) return;
                prepareAccountSession(previous, userId);
                setReadyUserId(userId);
            })
            .catch((error) => {
                if (active) setPreparationError(error instanceof Error ? error.message : "账户创作空间初始化失败");
            });
        return () => {
            active = false;
        };
    }, [queryClient, retryVersion, userId]);

    if (!userId) return <>{children}</>;
    if (readyUserId === userId) return <>{children}</>;

    return (
        <div className="grid min-h-dvh place-items-center bg-background px-6 text-center text-foreground" role="status" aria-live="polite">
            <div>
                <span className="mx-auto mb-4 block size-6 animate-spin rounded-full border-2 border-stone-300 border-t-[#c9a86a] dark:border-stone-700 dark:border-t-[#d8b36d]" aria-hidden="true" />
                <p className="text-sm text-stone-600 dark:text-stone-300">正在准备创作空间……</p>
                {preparationError ? (
                    <button type="button" className="mt-3 text-xs text-[#b44735] hover:underline dark:text-[#d8b36d]" onClick={() => setRetryVersion((value) => value + 1)}>
                        初始化未完成，点击重试
                    </button>
                ) : null}
            </div>
        </div>
    );
}

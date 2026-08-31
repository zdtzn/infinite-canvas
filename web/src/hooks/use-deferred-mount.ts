import { useEffect, useState } from "react";

type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
};

export function useDeferredMount(delayMs: number, idleTimeoutMs = 1_200) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const idleWindow = window as IdleWindow;
        let idleHandle: number | undefined;
        const timeoutHandle = window.setTimeout(() => {
            if (idleWindow.requestIdleCallback) idleHandle = idleWindow.requestIdleCallback(() => setReady(true), { timeout: idleTimeoutMs });
            else setReady(true);
        }, delayMs);

        return () => {
            window.clearTimeout(timeoutHandle);
            if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
        };
    }, [delayMs, idleTimeoutMs]);

    return ready;
}

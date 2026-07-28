import { lazy, type ComponentType } from "react";

const CHUNK_RELOAD_KEY = "infinite-canvas:chunk-reload";

export function lazyRoute<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
    return lazy<T>(async () => {
        try {
            const module = await loader();
            clearChunkRecoveryMarker();
            return module;
        } catch (error) {
            if (attemptChunkRecovery(error)) return new Promise<never>(() => undefined);
            throw error;
        }
    });
}

export function isChunkLoadError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /failed to fetch dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed|chunkloaderror/i.test(message);
}

export function attemptChunkRecovery(error: unknown) {
    if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
    try {
        if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
        window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return true;
    } catch {
        return false;
    }
}

export function installChunkLoadRecovery() {
    if (typeof window === "undefined") return () => undefined;
    const handleRejection = (event: PromiseRejectionEvent) => {
        if (!attemptChunkRecovery(event.reason)) return;
        event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
}

function clearChunkRecoveryMarker() {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
        // Session storage can be unavailable in hardened browser modes.
    }
}

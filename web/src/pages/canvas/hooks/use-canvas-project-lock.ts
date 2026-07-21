import { useCallback, useEffect, useMemo, useState } from "react";

const LOCK_TTL_MS = 12_000;
const HEARTBEAT_MS = 4_000;

type LockRecord = { tabId: string; expiresAt: number };

export function useCanvasProjectLock(projectId: string) {
    const tabId = useMemo(() => getTabId(), []);
    const key = `infinite-canvas:project-lock:${projectId}`;
    const [canEdit, setCanEdit] = useState(true);

    const claim = useCallback(
        (force = false) => {
            if (!projectId) return false;
            const current = readLock(key);
            const available = force || !current || current.expiresAt <= Date.now() || current.tabId === tabId;
            if (available) localStorage.setItem(key, JSON.stringify({ tabId, expiresAt: Date.now() + LOCK_TTL_MS } satisfies LockRecord));
            setCanEdit(available);
            return available;
        },
        [key, projectId, tabId],
    );

    useEffect(() => {
        claim();
        const heartbeat = window.setInterval(() => claim(), HEARTBEAT_MS);
        const handleStorage = (event: StorageEvent) => {
            if (event.key === key) claim();
        };
        window.addEventListener("storage", handleStorage);
        return () => {
            window.clearInterval(heartbeat);
            window.removeEventListener("storage", handleStorage);
            if (readLock(key)?.tabId === tabId) localStorage.removeItem(key);
        };
    }, [claim, key, tabId]);

    return { canEdit, takeOver: () => claim(true) };
}

function getTabId() {
    const key = "infinite-canvas:tab-id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
}

function readLock(key: string): LockRecord | null {
    try {
        return JSON.parse(localStorage.getItem(key) || "null") as LockRecord | null;
    } catch {
        return null;
    }
}

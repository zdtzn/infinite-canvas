import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useUserStore } from "@/stores/use-user-store";

import { imperialPreferenceKey, localDayKey, readImperialBoolean, useImperialMode, writeImperialBoolean } from "./imperial-mode";
import { ImperialSeal } from "./imperial-seal";
import "./imperial-welcome.css";

export function ImperialWelcome() {
    const { isImperialMode, imperialWelcomeEnabled, imperialActivation } = useImperialMode();
    const userId = useUserStore((state) => state.user?.id || "");
    const handled = useRef({ userId: "", activation: 0, day: "" });
    const [arrival, setArrival] = useState<{ userId: string; id: number } | null>(null);

    useEffect(() => {
        if (!isImperialMode || !userId) return;
        if (handled.current.userId !== userId) handled.current = { userId, activation: 0, day: "" };
        const day = localDayKey();
        const key = `${imperialPreferenceKey(userId, "welcome-seen")}:v3:${day}`;
        const explicitlyActivated = imperialActivation > handled.current.activation;
        const firstArrival = imperialWelcomeEnabled && handled.current.day !== day && !readImperialBoolean(key, false);
        handled.current.activation = imperialActivation;
        if (!explicitlyActivated && !firstArrival) return;
        handled.current.day = day;
        writeImperialBoolean(key, true);
        setArrival({ userId, id: Date.now() });
    }, [imperialActivation, imperialWelcomeEnabled, isImperialMode, userId]);

    // Keep dismissal independent of the once-per-day guard, including StrictMode effect replay.
    useEffect(() => {
        if (!arrival) return;
        const timeout = window.setTimeout(() => setArrival(null), 1000);
        return () => window.clearTimeout(timeout);
    }, [arrival]);

    if (!arrival || arrival.userId !== userId || !isImperialMode) return null;
    return createPortal(
        <aside key={arrival.id} className="emperor-arrival" role="status" aria-live="polite">
            <span className="emperor-arrival-rule" aria-hidden="true" />
            <div className="emperor-arrival-title">
                <ImperialSeal className="size-16" decorative />
                <div>
                    <strong className="font-display">帝境已启</strong>
                    <span>诸天万象，静候落笔。</span>
                </div>
            </div>
        </aside>,
        document.body,
    );
}

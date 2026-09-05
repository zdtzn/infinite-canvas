import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";

import { useCultivationProfile } from "./queries";
import { ImperialSeal } from "./imperial-seal";

export const DOU_EMPEROR_REALM_ID = "realm-dou-emperor";
export const imperialModeChangeEvent = "infinite-canvas:imperial-mode-change";

export const imperialHeroQuotes = [
    "诸天万界，皆可入画。",
    "创作没有终点，斗帝亦不断探索。",
    "天地规则，不过一笔之间。",
    "万象由心，诸界皆成。",
    "一念落笔，可绘山河。",
    "万法归一，诸天俯首。",
    "星河为卷，灵感为墨。",
    "手握日月摘星辰，世间无我这般人。",
] as const;

export const imperialGenerationQuotes = [
    "诸天再添一卷。",
    "天地法则已记录此次创作。",
    "万象已成。",
    "一念落笔，可绘山河。",
    "创作再次铭刻天地。",
    "星河为卷，此作已成。",
    "诸界灵感，于此刻凝形。",
    "一笔既落，万象自生。",
    "山河入画，天地留痕。",
    "此念已化作画卷。",
    "万法归于一幅新作。",
    "灵感越过星海而来。",
    "诸天万界，再添一景。",
    "这一笔，已被天地记住。",
    "画卷展开，万象归位。",
    "星辰见证了这次创作。",
    "天地辽阔，灵感无界。",
    "万象由心，此刻成真。",
    "规则交汇，新作已成。",
    "斗帝之笔，再落一卷。",
] as const;

export const imperialLoadingMessages = ["演化天地法则……", "推演万象……", "绘制诸天画卷……", "重构世界……", "演算天地……"] as const;

type ImperialModeContextValue = {
    isDouEmperor: boolean;
    isImperialMode: boolean;
    imperialWelcomeEnabled: boolean;
    imperialHeroQuote: string;
    imperialActivation: number;
    setImperialModeEnabled: (enabled: boolean) => void;
    setImperialWelcomeEnabled: (enabled: boolean) => void;
    generationSuccessMessage: (message: string) => ReactNode;
};

const ImperialModeContext = createContext<ImperialModeContextValue | null>(null);

export function isDouEmperorRealm(realmId: string | undefined | null) {
    return realmId === DOU_EMPEROR_REALM_ID;
}

export function localDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function imperialQuoteFor(seed: string, quotes: readonly string[] = imperialHeroQuotes) {
    if (!quotes.length) return "";
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    return quotes[hash % quotes.length];
}

export function imperialPreferenceKey(userId: string, name: "mode" | "welcome" | "welcome-seen") {
    return `infinite-canvas:imperial:${name}:${userId}`;
}

export function readImperialBoolean(key: string, fallback: boolean) {
    if (typeof window === "undefined") return fallback;
    try {
        const value = window.localStorage.getItem(key);
        return value == null ? fallback : value === "true";
    } catch {
        return fallback;
    }
}

export function writeImperialBoolean(key: string, value: boolean) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        // A blocked localStorage should never affect image creation or navigation.
    }
}

export function ImperialModeProvider({ children }: { children: ReactNode }) {
    const userId = useUserStore((state) => state.user?.id || "");
    const { data: profile } = useCultivationProfile();
    const [imperialModeEnabled, setImperialModeEnabledState] = useState(() => readImperialBoolean(imperialPreferenceKey(userId, "mode"), true));
    const [imperialWelcomeEnabled, setImperialWelcomeEnabledState] = useState(() => readImperialBoolean(imperialPreferenceKey(userId, "welcome"), true));
    const [preferenceUserId, setPreferenceUserId] = useState(userId);
    const [activation, setActivation] = useState({ userId, sequence: 0 });
    const imperialActivation = activation.userId === userId ? activation.sequence : 0;
    const isDouEmperor = isDouEmperorRealm(profile?.realmId);
    const isImperialMode = isDouEmperor && preferenceUserId === userId && imperialModeEnabled;
    const day = localDayKey();
    const imperialHeroQuote = useMemo(() => imperialQuoteFor(`${userId}:${day}`), [day, userId]);

    useEffect(() => {
        setImperialModeEnabledState(readImperialBoolean(imperialPreferenceKey(userId, "mode"), true));
        setImperialWelcomeEnabledState(readImperialBoolean(imperialPreferenceKey(userId, "welcome"), true));
        setPreferenceUserId(userId);
        setActivation({ userId, sequence: 0 });
    }, [userId]);

    useEffect(() => {
        if (typeof document === "undefined") return;
        if (isImperialMode) document.documentElement.dataset.imperialMode = "true";
        else delete document.documentElement.dataset.imperialMode;
        window.dispatchEvent(new Event(imperialModeChangeEvent));
    }, [isImperialMode]);

    useEffect(
        () => () => {
            if (typeof document === "undefined") return;
            delete document.documentElement.dataset.imperialMode;
            window.dispatchEvent(new Event(imperialModeChangeEvent));
        },
        [],
    );

    const setImperialModeEnabled = useCallback(
        (enabled: boolean) => {
            if (!isDouEmperor) return;
            if (enabled && !isImperialMode) setActivation((previous) => ({ userId, sequence: previous.userId === userId ? previous.sequence + 1 : 1 }));
            setImperialModeEnabledState(enabled);
            if (userId) writeImperialBoolean(imperialPreferenceKey(userId, "mode"), enabled);
        },
        [isDouEmperor, isImperialMode, userId],
    );

    const setImperialWelcomeEnabled = useCallback(
        (enabled: boolean) => {
            setImperialWelcomeEnabledState(enabled);
            if (userId) writeImperialBoolean(imperialPreferenceKey(userId, "welcome"), enabled);
        },
        [userId],
    );

    const generationSuccessMessage = useCallback(
        (message: string) => {
            if (!isImperialMode) return message;
            return (
                <span className="imperial-success-message">
                    <ImperialSeal className="imperial-success-seal" decorative />
                    <span>{message}</span>
                    <span>一念落笔，万象成卷。</span>
                </span>
            );
        },
        [isImperialMode],
    );

    const value = useMemo(
        () => ({
            isDouEmperor,
            isImperialMode,
            imperialWelcomeEnabled,
            imperialHeroQuote,
            imperialActivation,
            setImperialModeEnabled,
            setImperialWelcomeEnabled,
            generationSuccessMessage,
        }),
        [generationSuccessMessage, imperialHeroQuote, imperialActivation, imperialWelcomeEnabled, isDouEmperor, isImperialMode, setImperialModeEnabled, setImperialWelcomeEnabled],
    );

    return <ImperialModeContext.Provider value={value}>{children}</ImperialModeContext.Provider>;
}

export function useImperialMode() {
    const value = useContext(ImperialModeContext);
    if (!value) throw new Error("useImperialMode must be used within ImperialModeProvider");
    return value;
}

export function useImperialGenerationCue() {
    const { isImperialMode } = useImperialMode();
    const [active, setActive] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    useEffect(
        () => () => {
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        },
        [],
    );

    const trigger = useCallback(() => {
        if (!isImperialMode) return;
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        setActive(true);
        timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = null;
            setActive(false);
        }, 300);
    }, [isImperialMode]);

    return { active: isImperialMode && active, trigger };
}

export function useImperialLoadingText(fallback: string, scope: string) {
    const { isImperialMode } = useImperialMode();
    const userId = useUserStore((state) => state.user?.id || "guest");
    const seed = useMemo(() => `${userId}:${scope}:${Date.now()}`, [scope, userId]);
    return isImperialMode ? imperialQuoteFor(seed, imperialLoadingMessages) : fallback;
}

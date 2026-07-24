import { Crown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Switch, Tooltip } from "antd";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

import { useCultivationProfile } from "./queries";

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

const imperialGenerationQuotes = ["诸天万界，再添一幅画卷。", "创作已铭刻于天地。", "斗帝之笔，再落一卷。", "天地法则，为你记录此次创作。"] as const;

type ImperialModeContextValue = {
    isDouEmperor: boolean;
    isImperialMode: boolean;
    imperialWelcomeEnabled: boolean;
    imperialHeroQuote: string;
    setImperialModeEnabled: (enabled: boolean) => void;
    setImperialWelcomeEnabled: (enabled: boolean) => void;
    generationSuccessMessage: (message: string) => string;
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

function preferenceKey(userId: string, name: "mode" | "welcome" | "welcome-seen") {
    return `infinite-canvas:imperial:${name}:${userId}`;
}

function readBoolean(key: string, fallback: boolean) {
    if (typeof window === "undefined") return fallback;
    try {
        const value = window.localStorage.getItem(key);
        return value == null ? fallback : value === "true";
    } catch {
        return fallback;
    }
}

function writeBoolean(key: string, value: boolean) {
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
    const [imperialModeEnabled, setImperialModeEnabledState] = useState(true);
    const [imperialWelcomeEnabled, setImperialWelcomeEnabledState] = useState(true);
    const isDouEmperor = isDouEmperorRealm(profile?.realmId);
    const isImperialMode = isDouEmperor && imperialModeEnabled;
    const day = localDayKey();
    const imperialHeroQuote = useMemo(() => imperialQuoteFor(`${userId}:${day}`), [day, userId]);

    useEffect(() => {
        if (!userId) return;
        setImperialModeEnabledState(readBoolean(preferenceKey(userId, "mode"), true));
        setImperialWelcomeEnabledState(readBoolean(preferenceKey(userId, "welcome"), true));
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
            setImperialModeEnabledState(enabled);
            if (userId) writeBoolean(preferenceKey(userId, "mode"), enabled);
        },
        [userId],
    );

    const setImperialWelcomeEnabled = useCallback(
        (enabled: boolean) => {
            setImperialWelcomeEnabledState(enabled);
            if (userId) writeBoolean(preferenceKey(userId, "welcome"), enabled);
        },
        [userId],
    );

    const generationSuccessMessage = useCallback(
        (message: string) => {
            if (!isDouEmperor) return message;
            return `${message} · ${imperialQuoteFor(`${userId}:${Date.now()}`, imperialGenerationQuotes)}`;
        },
        [isDouEmperor, userId],
    );

    const value = useMemo(
        () => ({
            isDouEmperor,
            isImperialMode,
            imperialWelcomeEnabled,
            imperialHeroQuote,
            setImperialModeEnabled,
            setImperialWelcomeEnabled,
            generationSuccessMessage,
        }),
        [generationSuccessMessage, imperialHeroQuote, imperialWelcomeEnabled, isDouEmperor, isImperialMode, setImperialModeEnabled, setImperialWelcomeEnabled],
    );

    return <ImperialModeContext.Provider value={value}>{children}</ImperialModeContext.Provider>;
}

export function useImperialMode() {
    const value = useContext(ImperialModeContext);
    if (!value) throw new Error("useImperialMode must be used within ImperialModeProvider");
    return value;
}

export function ImperialModeBadge() {
    const { isDouEmperor, isImperialMode, setImperialModeEnabled } = useImperialMode();
    if (!isDouEmperor) return null;

    return (
        <Tooltip title="诸天至尊">
            <button type="button" role="switch" aria-checked={isImperialMode} aria-label={isImperialMode ? "关闭帝临模式" : "开启帝临模式"} className="imperial-mode-badge" onClick={() => setImperialModeEnabled(!isImperialMode)}>
                <Crown className="size-3.5 shrink-0" />
                <span className="hidden xl:inline">斗帝</span>
                <span>帝临模式</span>
                <span className="imperial-mode-badge-indicator" aria-hidden="true" />
            </button>
        </Tooltip>
    );
}

export function ImperialModePreferences() {
    const { isDouEmperor, isImperialMode, imperialWelcomeEnabled, setImperialModeEnabled, setImperialWelcomeEnabled } = useImperialMode();
    if (!isDouEmperor) return null;

    return (
        <section className="imperial-mode-preferences">
            <div className="imperial-mode-preferences-heading">
                <div>
                    <div className="inline-flex items-center gap-2 text-sm font-semibold">
                        <Crown className="size-4" />
                        帝临模式
                    </div>
                    <p>斗帝专属视觉偏好仅保存在当前浏览器，不影响创作配置。</p>
                </div>
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">启用帝临模式</div>
                    <p>使用深空蓝、淡金强调和极淡星纹主题。</p>
                </div>
                <Switch size="small" checked={isImperialMode} onChange={setImperialModeEnabled} />
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">首页欢迎</div>
                    <p>每天首次进入首页时显示一次斗帝欢迎提示。</p>
                </div>
                <Switch size="small" checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} />
            </div>
        </section>
    );
}

export function ImperialWelcome() {
    const { pathname } = useLocation();
    const reducedMotion = useReducedMotion();
    const { isDouEmperor, imperialWelcomeEnabled } = useImperialMode();
    const userId = useUserStore((state) => state.user?.id || "");
    const [visible, setVisible] = useState(false);
    const handledKey = useRef("");

    useEffect(() => {
        if (!isDouEmperor || !imperialWelcomeEnabled || pathname !== "/" || !userId) {
            setVisible(false);
            return;
        }
        const key = `${preferenceKey(userId, "welcome-seen")}:${localDayKey()}`;
        if (handledKey.current === key) return;
        if (readBoolean(key, false)) {
            setVisible(false);
            return;
        }

        handledKey.current = key;
        writeBoolean(key, true);
        setVisible(true);
        const timeout = window.setTimeout(() => setVisible(false), reducedMotion ? 650 : 2_000);
        return () => window.clearTimeout(timeout);
    }, [imperialWelcomeEnabled, isDouEmperor, pathname, reducedMotion, userId]);

    return (
        <AnimatePresence>
            {visible ? (
                <motion.aside
                    className="imperial-welcome"
                    role="status"
                    aria-live="polite"
                    initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
                    transition={{ duration: reducedMotion ? 0.12 : 0.34, ease: "easeOut" }}
                >
                    <Crown className="size-4" />
                    <div>
                        <strong>恭迎斗帝降临</strong>
                        <span>诸天万界，为您开启。</span>
                    </div>
                </motion.aside>
            ) : null}
        </AnimatePresence>
    );
}

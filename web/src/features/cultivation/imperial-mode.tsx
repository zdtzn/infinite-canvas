import { Crown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Switch } from "antd";
import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";

import { useCultivationProfile } from "./queries";

export const DOU_EMPEROR_REALM_ID = "realm-dou-emperor";
export const imperialModeChangeEvent = "infinite-canvas:imperial-mode-change";

const imperialWelcomeParticles = [
    { originX: 5, originY: 24, x: -38, y: -22, size: 3, delay: 0 },
    { originX: 12, originY: 78, x: -46, y: 18, size: 2, delay: 40 },
    { originX: 21, originY: 8, x: -24, y: -34, size: 4, delay: 80 },
    { originX: 31, originY: 92, x: -14, y: 36, size: 2, delay: 20 },
    { originX: 42, originY: 4, x: -6, y: -40, size: 2, delay: 120 },
    { originX: 54, originY: 96, x: 8, y: 38, size: 3, delay: 70 },
    { originX: 66, originY: 6, x: 16, y: -38, size: 2, delay: 30 },
    { originX: 77, originY: 90, x: 27, y: 32, size: 4, delay: 110 },
    { originX: 88, originY: 14, x: 42, y: -26, size: 2, delay: 55 },
    { originX: 96, originY: 68, x: 48, y: 14, size: 3, delay: 95 },
    { originX: 3, originY: 52, x: -52, y: -2, size: 2, delay: 135 },
    { originX: 97, originY: 42, x: 54, y: -8, size: 2, delay: 15 },
] as const;

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
            if (!isImperialMode) return message;
            const quote = imperialQuoteFor(`${userId}:${Date.now()}`, imperialGenerationQuotes);
            return (
                <span className="imperial-success-message">
                    <span>{message}</span>
                    <span>{quote}</span>
                </span>
            );
        },
        [isImperialMode, userId],
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

export function useImperialGenerationCue() {
    const { isDouEmperor } = useImperialMode();
    const [active, setActive] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    useEffect(
        () => () => {
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        },
        [],
    );

    const trigger = useCallback(() => {
        if (!isDouEmperor) return;
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        setActive(true);
        timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = null;
            setActive(false);
        }, 300);
    }, [isDouEmperor]);

    return { active: isDouEmperor && active, trigger };
}

export function useImperialLoadingText(fallback: string, scope: string) {
    const { isImperialMode } = useImperialMode();
    const userId = useUserStore((state) => state.user?.id || "guest");
    const seed = useMemo(() => `${userId}:${scope}:${Date.now()}`, [scope, userId]);
    return isImperialMode ? imperialQuoteFor(seed, imperialLoadingMessages) : fallback;
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
                    <p>每天首次进入网站时显示一次斗帝欢迎提示。</p>
                </div>
                <Switch size="small" checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} />
            </div>
        </section>
    );
}

export function ImperialWelcome() {
    const reducedMotion = useReducedMotion();
    const { isDouEmperor, imperialWelcomeEnabled } = useImperialMode();
    const userId = useUserStore((state) => state.user?.id || "");
    const [visible, setVisible] = useState(false);
    const handledKey = useRef("");

    useEffect(() => {
        if (!isDouEmperor || !imperialWelcomeEnabled || !userId) {
            setVisible(false);
            return;
        }
        const key = `${preferenceKey(userId, "welcome-seen")}:v2:${localDayKey()}`;
        if (handledKey.current === key) return;
        if (readBoolean(key, false)) {
            setVisible(false);
            return;
        }

        handledKey.current = key;
        writeBoolean(key, true);
        setVisible(true);
        const timeout = window.setTimeout(() => setVisible(false), reducedMotion ? 850 : 2_350);
        return () => window.clearTimeout(timeout);
    }, [imperialWelcomeEnabled, isDouEmperor, reducedMotion, userId]);

    return (
        <AnimatePresence>
            {visible ? (
                <motion.aside
                    className="imperial-welcome"
                    role="status"
                    aria-live="polite"
                    initial={reducedMotion ? false : { opacity: 0, y: -14, scale: 0.96, filter: "blur(5px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.015, filter: "blur(6px)" }}
                    transition={{ duration: reducedMotion ? 0.12 : 0.42, ease: [0.16, 1, 0.3, 1] }}
                >
                    <div className="imperial-welcome-surface" aria-hidden="true" />
                    <div className="imperial-welcome-particles" aria-hidden="true">
                        {imperialWelcomeParticles.map((particle, index) => (
                            <span
                                key={`${particle.originX}-${particle.originY}`}
                                className="imperial-welcome-particle"
                                style={
                                    {
                                        "--particle-origin-x": `${particle.originX}%`,
                                        "--particle-origin-y": `${particle.originY}%`,
                                        "--particle-x": `${particle.x}px`,
                                        "--particle-y": `${particle.y}px`,
                                        "--particle-size": `${particle.size}px`,
                                        "--particle-delay": `${particle.delay}ms`,
                                        "--particle-scale": String(0.7 + (index % 4) * 0.18),
                                    } as CSSProperties
                                }
                            />
                        ))}
                    </div>
                    <span className="imperial-welcome-mark" aria-hidden="true">
                        <Crown className="size-5" />
                    </span>
                    <div className="imperial-welcome-copy">
                        <span className="imperial-welcome-eyebrow">DOU EMPEROR · SUPREME REALM</span>
                        <strong>恭迎斗帝降临</strong>
                        <span>诸天万界，为您开启。</span>
                    </div>
                </motion.aside>
            ) : null}
        </AnimatePresence>
    );
}

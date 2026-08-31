import { Crown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";

import { imperialPreferenceKey, localDayKey, readImperialBoolean, useImperialMode, writeImperialBoolean } from "./imperial-mode";

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
        const key = `${imperialPreferenceKey(userId, "welcome-seen")}:v3:${localDayKey()}`;
        if (handledKey.current === key) return;
        if (readImperialBoolean(key, false)) {
            setVisible(false);
            return;
        }

        handledKey.current = key;
        writeImperialBoolean(key, true);
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

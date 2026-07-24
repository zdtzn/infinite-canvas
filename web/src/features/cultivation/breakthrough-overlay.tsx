import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { markCultivationBreakthroughSeen, type CultivationBreakthrough } from "@/services/server-api";

import { cultivationCapabilityLabel } from "./utils";
import { cultivationProfileQueryKey, useCultivationProfile } from "./queries";

const previewEventName = "canvas:cultivation-preview";

type BreakthroughPreview = {
    fromStageName: string;
    toStageName: string;
    animationPreset?: string;
};

type ActiveBreakthrough = CultivationBreakthrough & {
    animationPreset: string;
    preview: boolean;
    unlockedCapabilities: string[];
};

type ProfileSnapshot = {
    userId: string;
    totalXp: number;
    capabilities: string[];
};

type XpGain = { id: string; amount: number };

export function previewCultivationBreakthrough(preview: BreakthroughPreview) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<BreakthroughPreview>(previewEventName, { detail: preview }));
}

export function CultivationBreakthroughOverlay() {
    const queryClient = useQueryClient();
    const { data } = useCultivationProfile();
    const reducedMotion = useReducedMotion();
    const handled = useRef("");
    const profileSnapshot = useRef<ProfileSnapshot | null>(null);
    const [activeBreakthrough, setActiveBreakthrough] = useState<ActiveBreakthrough | null>(null);
    const [xpGain, setXpGain] = useState<XpGain | null>(null);
    const event = data?.breakthrough;

    useEffect(() => {
        if (!data) return;
        const previous = profileSnapshot.current;
        const sameUser = previous?.userId === data.userId;
        const unlockedCapabilities = sameUser ? data.capabilities.filter((key) => !previous.capabilities.includes(key)) : [];

        if (sameUser && data.totalXp > previous.totalXp) {
            setXpGain({ id: `${data.userId}-${data.totalXp}`, amount: data.totalXp - previous.totalXp });
        }
        if (event && handled.current !== event.id) {
            handled.current = event.id;
            setActiveBreakthrough({ ...event, animationPreset: data.animationPreset || "minimal-line", preview: false, unlockedCapabilities });
        }
        profileSnapshot.current = { userId: data.userId, totalXp: data.totalXp, capabilities: data.capabilities };
    }, [data, event]);

    useEffect(() => {
        const showPreview = (customEvent: Event) => {
            const preview = (customEvent as CustomEvent<BreakthroughPreview>).detail;
            if (!preview) return;
            setActiveBreakthrough((current) =>
                current && !current.preview
                    ? current
                    : {
                          id: `preview-${Date.now()}`,
                          fromStageName: preview.fromStageName,
                          toStageName: preview.toStageName,
                          status: "preview",
                          animationPreset: preview.animationPreset || "minimal-line",
                          preview: true,
                          unlockedCapabilities: [],
                      },
            );
        };
        window.addEventListener(previewEventName, showPreview);
        return () => window.removeEventListener(previewEventName, showPreview);
    }, []);

    useEffect(() => {
        if (!activeBreakthrough) return;
        const duration = reducedMotion ? 180 : 900;
        const timer = window.setTimeout(() => {
            setActiveBreakthrough(null);
            if (!activeBreakthrough.preview) void markCultivationBreakthroughSeen(activeBreakthrough.id).finally(() => queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey }));
        }, duration);
        return () => window.clearTimeout(timer);
    }, [activeBreakthrough, queryClient, reducedMotion]);

    useEffect(() => {
        if (!xpGain) return;
        const timer = window.setTimeout(() => setXpGain(null), reducedMotion ? 180 : 1100);
        return () => window.clearTimeout(timer);
    }, [reducedMotion, xpGain]);

    const breakthroughOffset = activeBreakthrough?.animationPreset === "soft-flare" ? 8 : activeBreakthrough?.animationPreset === "digital-ring" ? 14 : 20;

    return (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[1000] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col items-stretch gap-2" aria-live="polite" aria-atomic="true">
            <AnimatePresence initial={false}>
                {activeBreakthrough ? (
                    <motion.section
                        key={activeBreakthrough.id}
                        role="status"
                        className="cultivation-feedback cultivation-feedback-breakthrough"
                        initial={reducedMotion ? false : { opacity: 0, x: breakthroughOffset, y: 4, scale: 0.985 }}
                        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 10, scale: 0.985 }}
                        transition={{ duration: reducedMotion ? 0.1 : 0.22, ease: "easeOut" }}
                    >
                        <div className="flex items-start gap-3">
                            <span className="cultivation-feedback-icon">
                                <Sparkles className="size-4" />
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-stone-950 dark:text-stone-50">境界提升</div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600 dark:text-stone-300">
                                    <span>{activeBreakthrough.fromStageName}</span>
                                    <ArrowRight className="size-3.5 text-stone-400" />
                                    <strong className="font-semibold text-stone-950 dark:text-stone-50">{activeBreakthrough.toStageName}</strong>
                                </div>
                                {activeBreakthrough.unlockedCapabilities.length ? (
                                    <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">已开放：{activeBreakthrough.unlockedCapabilities.slice(0, 3).map(cultivationCapabilityLabel).join("、")}</p>
                                ) : null}
                            </div>
                        </div>
                    </motion.section>
                ) : null}
                {xpGain ? (
                    <motion.div
                        key={xpGain.id}
                        role="status"
                        className="cultivation-feedback cultivation-feedback-xp"
                        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: reducedMotion ? 0.1 : 0.18, ease: "easeOut" }}
                    >
                        <CheckCircle2 className="size-4" />
                        <span>本次创作获得 +{xpGain.amount.toLocaleString()} 修为</span>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

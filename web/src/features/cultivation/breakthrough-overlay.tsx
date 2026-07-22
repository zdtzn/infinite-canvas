import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { markCultivationBreakthroughSeen, type CultivationBreakthrough } from "@/services/server-api";

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
};

export function previewCultivationBreakthrough(preview: BreakthroughPreview) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<BreakthroughPreview>(previewEventName, { detail: preview }));
}

export function CultivationBreakthroughOverlay() {
    const queryClient = useQueryClient();
    const { data } = useCultivationProfile();
    const reducedMotion = useReducedMotion();
    const handled = useRef("");
    const [activeBreakthrough, setActiveBreakthrough] = useState<ActiveBreakthrough | null>(null);
    const event = data?.breakthrough;

    useEffect(() => {
        if (!event || handled.current === event.id) return;
        handled.current = event.id;
        setActiveBreakthrough({ ...event, animationPreset: data?.animationPreset || "minimal-line", preview: false });
    }, [data?.animationPreset, event]);

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
                      },
            );
        };
        window.addEventListener(previewEventName, showPreview);
        return () => window.removeEventListener(previewEventName, showPreview);
    }, []);

    useEffect(() => {
        if (!activeBreakthrough) return;
        const duration = reducedMotion ? 350 : 1250;
        const timer = window.setTimeout(() => {
            setActiveBreakthrough(null);
            if (!activeBreakthrough.preview) void markCultivationBreakthroughSeen(activeBreakthrough.id).finally(() => queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey }));
        }, duration);
        return () => window.clearTimeout(timer);
    }, [activeBreakthrough, queryClient, reducedMotion]);

    return (
        <AnimatePresence>
            {activeBreakthrough ? (
                <motion.div key={activeBreakthrough.id} className="fixed inset-0 z-[1000] grid place-items-center bg-black/35 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.div
                        className="w-full max-w-md overflow-hidden rounded-lg border border-white/15 bg-stone-950/92 px-8 py-9 text-center text-white shadow-2xl"
                        initial={
                            reducedMotion
                                ? false
                                : activeBreakthrough.animationPreset === "soft-flare"
                                  ? { opacity: 0, scale: 0.96, filter: "blur(6px)" }
                                  : activeBreakthrough.animationPreset === "digital-ring"
                                    ? { opacity: 0, scale: 1.02, y: 4 }
                                    : { opacity: 0, scale: 0.97, y: 8 }
                        }
                        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.99 }}
                        transition={{ duration: reducedMotion ? 0.1 : 0.32, ease: "easeOut" }}
                    >
                        <div className="mx-auto mb-6 h-px w-20 bg-white/35" />
                        <div className="text-xs font-medium text-white/55">境界提升</div>
                        <div className="mt-4 flex items-center justify-center gap-3 text-lg font-semibold">
                            <span className="text-white/55">{activeBreakthrough.fromStageName}</span>
                            <span className="text-white/30">→</span>
                            <span>{activeBreakthrough.toStageName}</span>
                        </div>
                        <div className="mx-auto mt-6 h-px w-20 bg-white/35" />
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

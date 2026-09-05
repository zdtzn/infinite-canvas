import { ArrowRight } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { App, Image } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { DriftWall } from "@/components/home/drift-wall";
import { LightRays } from "@/components/home/light-rays";
import { useCultivationProfile } from "@/features/cultivation/queries";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { ImperialSeal } from "@/features/cultivation/imperial-seal";
import { cultivationStageLabel, quotaText } from "@/features/cultivation/utils";
import { promptImageCandidates, promptOriginalUrl } from "@/components/prompts/prompt-cover";
import { SpecularButton } from "@/components/ui/specular-button";
import { fetchHomepagePromptCovers, type PromptCover } from "@/services/api/prompts";
import { preloadRoute } from "@/lib/route-loaders";
import { lazyRoute } from "@/lib/lazy-route";
import { cn } from "@/lib/utils";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

import { HOMEPAGE_PROMPT_ROTATION_MS, HOMEPAGE_PROMPT_WINDOW_SIZE, promptIdentity, selectHomepagePromptShowcase, selectHomepagePromptWindow } from "./showcase";
import "./home.css";

const ImperialRealm = lazyRoute(() => import("@/features/cultivation/imperial-realm"));

/**
 * 山门 · 首页(方案B「山海境」开场版)
 * 功能不变:新建画布 / 继续最近项目 / 提示词精选与预览。
 * 视觉:AI 水墨山水 + 开场编排动画 + 金色浮尘 + 流光标题 + 修行引路条。
 */

export default function IndexPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [promptShowcase, setPromptShowcase] = useState<PromptCover[]>([]);
    const [showcaseOffset, setShowcaseOffset] = useState(0);
    const [showcaseHovered, setShowcaseHovered] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const { data: cultivation } = useCultivationProfile();
    const { isImperialMode } = useImperialMode();
    const promptSourcesRevision = usePromptSourceStore((state) => state.sources.map((source) => [source.id, source.name, source.githubUrl, source.enabled ? "1" : "0", source.script].join("\n")).join("\n---\n"));
    const visiblePromptShowcase = useMemo(() => selectHomepagePromptWindow(promptShowcase, showcaseOffset), [promptShowcase, showcaseOffset]);
    const promptIndexes = useMemo(() => new Map(promptShowcase.map((item, index) => [promptIdentity(item), index])), [promptShowcase]);
    const driftWallItems = useMemo(
        () =>
            visiblePromptShowcase.map((item) => ({
                id: promptIdentity(item),
                title: item.title,
                imageSources: promptImageCandidates(item.coverUrl, 760),
                originalIndex: promptIndexes.get(promptIdentity(item)) ?? 0,
            })),
        [promptIndexes, visiblePromptShowcase],
    );
    const previewItems = useMemo(() => promptShowcase.map((item) => ({ src: promptOriginalUrl(item.coverUrl), alt: item.title, decoding: "async" as const, referrerPolicy: "no-referrer" as const })), [promptShowcase]);

    useEffect(() => {
        let active = true;
        void fetchHomepagePromptCovers()
            .then((items) => {
                if (!active) return;
                setPromptShowcase(selectHomepagePromptShowcase(items));
                setShowcaseOffset(0);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
        return () => {
            active = false;
        };
    }, [message, promptSourcesRevision]);

    useEffect(() => {
        if (showcaseHovered || promptShowcase.length <= HOMEPAGE_PROMPT_WINDOW_SIZE) return;
        const timer = window.setInterval(() => {
            setShowcaseOffset((current) => (current + HOMEPAGE_PROMPT_WINDOW_SIZE) % promptShowcase.length);
        }, HOMEPAGE_PROMPT_ROTATION_MS);
        return () => window.clearInterval(timer);
    }, [promptShowcase.length, showcaseHovered]);

    return (
        <main className={cn("home-page h-full overflow-y-auto bg-background text-foreground", isImperialMode && "home-page--imperial")}>
            {/* ── 山门 · 全屏 Hero ─────────────────────────── */}
            {isImperialMode ? (
                <Suspense
                    fallback={
                        <section className="flex h-[calc(100svh-116px)] flex-col items-center justify-center gap-8 bg-[#1c2425]">
                            <h1 className="font-brush text-6xl text-[#f2f3ec]">无限画布</h1>
                            <Link to="/canvas?mode=new" className="p-3 text-[#e7d2a6]">
                                起笔 · 新建画布
                            </Link>
                        </section>
                    }
                >
                    <ImperialRealm />
                </Suspense>
            ) : (
                <section className="shj-hero relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center overflow-hidden">
                    <div className="shj-hero-stars" aria-hidden />
                    <div className="shj-hero-mist" aria-hidden />
                    <LightRays
                        raysOrigin="top-center"
                        raysColor={isImperialMode ? "#ffd166" : "#59d3ff"}
                        raysSpeed={0.72}
                        lightSpread={0.74}
                        rayLength={1.68}
                        pulsating
                        fadeDistance={1.2}
                        saturation={1.16}
                        followMouse
                        mouseInfluence={0.08}
                        noiseAmount={0.045}
                        distortion={0.045}
                        className={cn("homepage-light-rays", isImperialMode && "is-imperial")}
                    />
                    <div className="shj-hero-motes" aria-hidden />
                    <div className="shj-grain" aria-hidden />

                    {/* 两侧竖排楹联(仅宽屏,低存在感) */}
                    <span className="shj-vertical shj-couplet font-display home-enter-fade home-enter-delay-5 absolute left-10 top-1/2 hidden -translate-y-1/2 text-sm lg:block" aria-hidden>
                        雲海千重皆入畫
                    </span>
                    <span className="shj-vertical shj-couplet font-display home-enter-fade home-enter-delay-5 absolute right-10 top-1/2 hidden -translate-y-1/2 text-sm lg:block" aria-hidden>
                        心藏萬象筆先成
                    </span>

                    <div className="relative z-10 flex max-w-4xl flex-col items-center px-6 text-center">
                        <span className="shj-hero-eyebrow home-enter-rise home-enter-delay-1">Infinite Canvas</span>

                        <h1 className="font-brush shj-title-sheen home-enter-rise home-enter-delay-2 mt-8 whitespace-nowrap text-[4rem] leading-none sm:mt-10 sm:text-9xl md:text-[10rem] lg:text-[11rem]">无限画布</h1>

                        <p className="font-display shj-hero-tagline home-enter-rise home-enter-delay-3 mt-8 text-balance text-xl leading-8 tracking-[0.3em] sm:text-2xl">一笔落,万象生</p>

                        {cultivation ? (
                            <div className="home-enter-stamp home-enter-delay-4 mt-10 flex items-center gap-4">
                                <span className="shj-hero-realm-label text-sm tracking-[0.3em]">汝之境界</span>
                                <span className={cn("shj-seal-lg", isImperialMode && "is-imperial")}>{cultivationStageLabel(cultivation.realmName, cultivation.stageName)}</span>
                            </div>
                        ) : null}

                        <div className="home-enter-rise home-enter-delay-5 mt-14 flex flex-wrap items-center justify-center gap-4">
                            <SpecularButton
                                onClick={() => navigate("/canvas?mode=new")}
                                onPointerEnter={() => void preloadRoute("/canvas")}
                                onFocus={() => void preloadRoute("/canvas")}
                                onPointerDown={() => void preloadRoute("/canvas")}
                                onTouchStart={() => void preloadRoute("/canvas")}
                                radius={8}
                                tint="#d8402a"
                                tintOpacity={0.96}
                                blur={4}
                                textColor="#fff7ee"
                                lineColor="#ffe7b3"
                                baseColor="#8f2a20"
                                intensity={1.15}
                                shineSize={9}
                                shineFade={38}
                                thickness={1}
                                proximity={220}
                                className="group tracking-[0.2em]"
                            >
                                起笔 · 新建画布
                                <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-0.5" />
                            </SpecularButton>
                            <button
                                type="button"
                                onClick={() => navigate("/canvas?mode=recent")}
                                onPointerEnter={() => void preloadRoute("/canvas")}
                                onFocus={() => void preloadRoute("/canvas")}
                                onPointerDown={() => void preloadRoute("/canvas")}
                                onTouchStart={() => void preloadRoute("/canvas")}
                                className="shj-btn-ghost"
                            >
                                继续最近项目
                            </button>
                        </div>
                    </div>

                    <div className="home-enter-fade home-enter-delay-6 absolute inset-x-0 bottom-8 z-10 flex justify-center">
                        <span className="shj-scroll-cue">卷轴展开</span>
                    </div>
                </section>
            )}

            {/* ── 修行引路条 ──────────────────────────────── */}
            {cultivation ? (
                <section className="home-cultivation-strip border-y border-[rgb(237_237_230/0.08)] bg-[#141419]">
                    <div className="home-cultivation-inner mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
                        <div className="home-cultivation-identity flex items-center gap-4">
                            {isImperialMode ? <ImperialSeal className="size-11" /> : <span className="shj-seal">{cultivation.realmName}</span>}
                            <div className="flex flex-col gap-0.5">
                                <span className="font-display text-sm tracking-[0.15em] text-[#edede6]">今日修行</span>
                                <span className="home-cultivation-description text-xs text-[#8a8a96]">{quotaText(cultivation.remainingToday, cultivation.unlimited)} · 笔耕不辍,境界自现</span>
                            </div>
                        </div>
                        <Link
                            to="/cultivation"
                            onPointerEnter={() => void preloadRoute("/cultivation")}
                            onFocus={() => void preloadRoute("/cultivation")}
                            onPointerDown={() => void preloadRoute("/cultivation")}
                            onTouchStart={() => void preloadRoute("/cultivation")}
                            className="home-cultivation-link group inline-flex items-center gap-2 text-sm tracking-[0.1em] text-[#c9a86a] transition-colors hover:text-[#edede6]"
                        >
                            入命宫修行
                            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                        </Link>
                    </div>
                </section>
            ) : null}

            {/* ── 功法精选 ───────────────────────────────── */}
            <section className="home-showcase mx-auto max-w-6xl px-6 pb-24 pt-20">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="font-display text-3xl text-[#edede6] sm:text-4xl">功法精选</h2>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-[#8a8a96]">稳定出图的提示词,皆藏于此楼。收藏风格与结果,让下一次创作从已有经验开始。</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate("/prompts")}
                        onPointerEnter={() => void preloadRoute("/prompts")}
                        onFocus={() => void preloadRoute("/prompts")}
                        onPointerDown={() => void preloadRoute("/prompts")}
                        onTouchStart={() => void preloadRoute("/prompts")}
                        className="group inline-flex items-center gap-2 text-sm text-[#c9a86a] transition-colors hover:text-[#edede6]"
                    >
                        查看功法楼
                        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </button>
                </div>
                <hr className="shj-gold-hairline mb-10" />

                <div className="h-[480px] sm:h-[570px] lg:h-[650px]">
                    {driftWallItems.length > 0 ? (
                        <DriftWall
                            items={driftWallItems}
                            onHoverChange={setShowcaseHovered}
                            onItemClick={(_, originalIndex) => {
                                setPreviewIndex(originalIndex);
                                setPreviewOpen(true);
                            }}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm tracking-[0.12em] text-[#777783]" role="status">
                            正在展开功法画卷...
                        </div>
                    )}
                </div>
            </section>

            <Image.PreviewGroup
                items={previewItems}
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            />
        </main>
    );
}

import { App, Button, Result, Skeleton, Tooltip } from "antd";
import { ArrowUpRight, Camera, CheckCircle2, ImagePlus, Infinity as InfinityIcon, LoaderCircle, Maximize2, Settings2 } from "lucide-react";
import { type ChangeEvent, type CSSProperties, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { cultivationRealmHero } from "@/features/cultivation/realm-hero";
import { cultivationAccentColor, cultivationCapabilityLabel, cultivationProgressPercent, cultivationStageLabel } from "@/features/cultivation/utils";
import { cn } from "@/lib/utils";
import type { CultivationProfile } from "@/services/server-api";
import { uploadProfileAvatar } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

export default function CultivationPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data, isLoading, isError, refetch } = useCultivationProfile();
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const { isDouEmperor, isImperialMode, imperialHeroQuote } = useImperialMode();
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > MAX_AVATAR_BYTES) {
            message.error("头像文件不能超过 2 MB");
            return;
        }
        if (file.type && !ALLOWED_AVATAR_TYPES.has(file.type.toLowerCase())) {
            message.error("仅支持 PNG、JPEG、WebP 或 AVIF 格式的头像");
            return;
        }

        setAvatarUploading(true);
        try {
            const result = await uploadProfileAvatar(file);
            if (user) setSession({ ...user, avatarUrl: result.avatarUrl });
            queryClient.setQueryData<CultivationProfile>(cultivationProfileQueryKey, (profile) => (profile ? { ...profile, avatarUrl: result.avatarUrl } : profile));
            void queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey });
            message.success("头像已更新");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "头像上传失败");
        } finally {
            setAvatarUploading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="mx-auto max-w-6xl p-6">
                <Skeleton active />
            </div>
        );
    }
    if (isError || !data) return <Result status="warning" title="修炼信息暂时无法加载" extra={<Button onClick={() => void refetch()}>重新加载</Button>} />;

    const finalStage = !data.nextStageName;
    const stageLabel = cultivationStageLabel(data.realmName, data.stageName);
    const accentColor = cultivationAccentColor(data.color);
    const avatarUrl = data.avatarUrl || user?.avatarUrl || "";
    const remainingQuota = data.unlimited ? null : Math.max(0, data.remainingToday || 0);
    const quotaConsumed = Math.max(0, data.usedToday + data.reservedToday);
    const quotaPercent = data.unlimited || !data.dailyLimit ? 0 : Math.max(0, Math.min(100, Math.round((quotaConsumed / data.dailyLimit) * 100)));
    const cultivationPercent = cultivationProgressPercent(data.currentXp, data.requiredXp, Boolean(data.pendingStageId));
    const capabilityPreview = data.capabilities.slice(0, 3).map(cultivationCapabilityLabel);
    const capabilityTail = Math.max(0, data.capabilities.length - capabilityPreview.length);
    const realmHero = cultivationRealmHero(data.realmId);
    const emperorFinalStage = isDouEmperor && finalStage;
    const heroProgressLabel = data.realmId === "realm-dou-emperor" ? "手握日月摘星辰，世间无我这般人！" : "当前修为";
    const nextStageSummary = finalStage ? "已抵达当前主题的最高境界" : data.pendingStageId ? "下一阶段正在等待管理员审批" : `距离 ${data.nextStageName} 还需 ${data.xpToNext.toLocaleString()} 修为`;

    return (
        <main className="cultivation-page h-full overflow-y-auto bg-background" style={{ "--cultivation-accent": accentColor, "--cultivation-hero-position": realmHero.imagePosition || "center" } as CSSProperties}>
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="cultivation-eyebrow">我的修炼</p>
                        <h1 className="mt-1 text-2xl font-semibold text-stone-950 dark:text-stone-100">创作成长</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        {user?.admin ? (
                            <Link to="/admin/cultivation" className="cultivation-secondary-link inline-flex items-center gap-1.5 text-sm">
                                <Settings2 className="size-4" />
                                修炼管理
                            </Link>
                        ) : null}
                        <Link to="/image" className="cultivation-secondary-link inline-flex items-center gap-1.5 text-sm">
                            <ImagePlus className="size-4" />
                            生图工作台
                        </Link>
                        <Link to="/canvas">
                            <Button type="primary" icon={<Maximize2 className="size-4" />}>
                                回到画布
                            </Button>
                        </Link>
                    </div>
                </header>

                <section className={cn("cultivation-hero mt-6", isImperialMode && "is-imperial")} aria-label={`${data.realmName} 境界意境`}>
                    <img src={realmHero.imageSrc} alt={`${data.realmName} 境界意境`} width={1600} height={900} className="cultivation-hero-art" decoding="async" fetchPriority="high" />
                    <div className="cultivation-hero-scrim" aria-hidden="true" />
                    <div className="cultivation-hero-content">
                        <div>
                            <div className="cultivation-hero-profile">
                                <div className="relative shrink-0">
                                    <div className={cn("cultivation-hero-avatar", isDouEmperor && "is-imperial")}>
                                        {avatarUrl ? <img src={avatarUrl} alt={`${data.displayName} 的头像`} width={48} height={48} className="size-full object-cover" /> : data.displayName.slice(0, 1).toUpperCase()}
                                    </div>
                                    <Tooltip title="上传头像">
                                        <button
                                            type="button"
                                            className="cultivation-avatar-trigger absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border"
                                            onClick={() => avatarInputRef.current?.click()}
                                            disabled={avatarUploading}
                                            aria-label="上传头像"
                                        >
                                            {avatarUploading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                                        </button>
                                    </Tooltip>
                                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(event) => void uploadAvatar(event)} />
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">{data.displayName}</div>
                                    <div className="mt-0.5 text-xs text-white/60">UID {data.userId.slice(0, 8)}</div>
                                </div>
                            </div>

                            <div className="cultivation-hero-stage">
                                <div className="cultivation-hero-realm-label">
                                    <RealmIcon iconKey={data.iconKey} className="size-4" />
                                    <span>当前境界</span>
                                </div>
                                <h2>{stageLabel}</h2>
                                <p>{realmHero.description}</p>
                                {capabilityPreview.length ? (
                                    <div className="cultivation-hero-capabilities">
                                        已开放：{capabilityPreview.join("、")}
                                        {capabilityTail ? ` 等 ${data.capabilities.length} 项能力` : ""}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="cultivation-hero-footer">
                            <div className="cultivation-hero-progress">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                    <span className="cultivation-hero-progress-label">{heroProgressLabel}</span>
                                    <span className="cultivation-hero-progress-value cultivation-count">{finalStage ? data.totalXp.toLocaleString() : `${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()}`}</span>
                                </div>
                                {emperorFinalStage ? (
                                    <>
                                        <div className="imperial-hero-final-state">
                                            <CheckCircle2 className="size-4" />
                                            <div>
                                                <span>已登临斗帝之境。</span>
                                                <span>天地已无更高境界。</span>
                                                <span>创作永无止境。</span>
                                            </div>
                                        </div>
                                        <p className="cultivation-hero-progress-message imperial-hero-quote">{imperialHeroQuote}</p>
                                    </>
                                ) : finalStage ? (
                                    <>
                                        <div className="cultivation-hero-complete-state">
                                            <CheckCircle2 className="size-4" />
                                            <span>当前主题已完成，持续创作会沉淀累计修为</span>
                                        </div>
                                        <p className="cultivation-hero-progress-message">{realmHero.completedProgressMessage || realmHero.progressMessage}</p>
                                    </>
                                ) : (
                                    <>
                                        <div className="cultivation-hero-progress-track" role="progressbar" aria-label="本阶段修为进度" aria-valuemin={0} aria-valuemax={data.requiredXp} aria-valuenow={Math.min(data.currentXp, data.requiredXp)}>
                                            <span style={{ width: `${cultivationPercent}%` }} />
                                        </div>
                                        <p className="cultivation-hero-next-stage">{nextStageSummary}</p>
                                        <p className="cultivation-hero-progress-message">{realmHero.progressMessage}</p>
                                    </>
                                )}
                            </div>
                            <Link to="/image" className="cultivation-hero-cta">
                                <ImagePlus className="size-4" />
                                继续创作
                                <ArrowUpRight className="size-4" />
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="cultivation-growth-section" aria-label="成长进度">
                    <GrowthMetric
                        label="修为成长"
                        value={finalStage ? "最高境界" : `${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()}`}
                        helper={finalStage ? "当前主题已完成，不再显示重复的满进度条" : data.pendingStageId ? "修为已满足突破条件，等待审批" : `还需 ${data.xpToNext.toLocaleString()} 修为`}
                        percent={cultivationPercent}
                        complete={finalStage}
                    />
                    <GrowthMetric
                        label="今日创作"
                        value={data.unlimited ? "不限次数" : `剩余 ${remainingQuota} 次`}
                        helper={data.unlimited ? `今日已使用 ${data.usedToday} 次` : `已使用 ${data.usedToday} / ${data.dailyLimit} 次${data.reservedToday ? ` · ${data.reservedToday} 次生成中占用` : ""}`}
                        percent={quotaPercent}
                        quota
                    />
                </section>

                <section className="cultivation-stats-grid" aria-label="创作统计">
                    <Metric label="累计修为" value={data.totalXp.toLocaleString()} />
                    <Metric label="累计生图" value={data.totalImages.toLocaleString()} />
                    <Metric label="累计创作天数" value={`${data.activeDays} 天`} />
                </section>

                {data.pendingStageId || data.publicMessage ? (
                    <section className="cultivation-notices" aria-live="polite">
                        {data.pendingStageId ? <Notice label="突破状态" text="修为已达到要求，下一阶段正在等待管理员审批。" tone="accent" /> : null}
                        {data.publicMessage ? <Notice label="来自管理员" text={data.publicMessage} /> : null}
                    </section>
                ) : null}
            </div>
        </main>
    );
}

function GrowthMetric({ label, value, helper, percent, complete, quota }: { label: string; value: string; helper: string; percent: number; complete?: boolean; quota?: boolean }) {
    return (
        <div className={`cultivation-growth-metric ${quota ? "is-quota" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium text-stone-800 dark:text-stone-200">{label}</span>
                <span className="cultivation-count text-sm text-stone-700 dark:text-stone-300">
                    {quota && value === "不限次数" ? (
                        <span className="inline-flex items-center gap-1">
                            <InfinityIcon className="size-4" />
                            不限次数
                        </span>
                    ) : (
                        value
                    )}
                </span>
            </div>
            {complete ? (
                <div className="cultivation-complete-state mt-3">
                    <CheckCircle2 className="size-4" />
                    <span>已完成当前主题成长</span>
                </div>
            ) : (
                <div className="cultivation-progress-track mt-3" aria-hidden="true">
                    <div className="cultivation-progress-fill" style={{ width: `${percent}%` }} />
                </div>
            )}
            <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{helper}</p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="cultivation-stat">
            <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
            <div className="cultivation-count mt-2 truncate text-xl font-semibold text-stone-950 dark:text-stone-100" title={value}>
                {value}
            </div>
        </div>
    );
}

function Notice({ label, text, tone }: { label: string; text: string; tone?: "accent" }) {
    return (
        <div className={`cultivation-notice ${tone === "accent" ? "cultivation-notice-accent" : ""}`}>
            <div className="text-sm font-medium text-stone-800 dark:text-stone-200">{label}</div>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">{text}</p>
        </div>
    );
}

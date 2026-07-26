import { App, Button, Result, Skeleton, Tooltip } from "antd";
import { ArrowUpRight, Camera, CheckCircle2, ImagePlus, Infinity as InfinityIcon, LoaderCircle, Maximize2, Settings2 } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { cultivationRealmHero } from "@/features/cultivation/realm-hero";
import { cultivationCapabilityLabel, cultivationProgressPercent, cultivationStageLabel } from "@/features/cultivation/utils";
import { cn } from "@/lib/utils";
import type { CultivationProfile } from "@/services/server-api";
import { uploadProfileAvatar } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

/** 境界阶梯(展示层,与 realm-hero 的十三重境界对应) */
const REALM_LADDER = [
    { id: "realm-dou-qi", name: "斗之气" },
    { id: "realm-dou-zhe", name: "斗者" },
    { id: "realm-dou-shi", name: "斗师" },
    { id: "realm-da-dou-shi", name: "大斗师" },
    { id: "realm-dou-ling", name: "斗灵" },
    { id: "realm-dou-wang", name: "斗王" },
    { id: "realm-dou-huang", name: "斗皇" },
    { id: "realm-dou-zong", name: "斗宗" },
    { id: "realm-dou-zun", name: "斗尊" },
    { id: "realm-dou-zun-peak", name: "斗尊巅峰" },
    { id: "realm-half-saint", name: "半圣" },
    { id: "realm-dou-saint", name: "斗圣" },
    { id: "realm-dou-emperor", name: "斗帝" },
] as const;

/**
 * 命宫 · 修炼页(方案B「山海境」)
 * 数据与逻辑零改动:修为/配额/审批/头像上传与旧版一致,仅重做呈现。
 */
export default function CultivationPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data, isLoading, isError, refetch } = useCultivationProfile();
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const { isDouEmperor } = useImperialMode();
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
    const avatarUrl = data.avatarUrl || user?.avatarUrl || "";
    const remainingQuota = data.unlimited ? null : Math.max(0, data.remainingToday || 0);
    const quotaConsumed = Math.max(0, data.usedToday + data.reservedToday);
    const quotaPercent = data.unlimited || !data.dailyLimit ? 0 : Math.max(0, Math.min(100, Math.round((quotaConsumed / data.dailyLimit) * 100)));
    const cultivationPercent = cultivationProgressPercent(data.currentXp, data.requiredXp, Boolean(data.pendingStageId));
    const realmHero = cultivationRealmHero(data.realmId);
    const emperorFinalStage = isDouEmperor && finalStage;
    const nextStageSummary = finalStage ? "已抵达当前主题的最高境界" : data.pendingStageId ? "下一阶段正在等待管理员审批" : `距离 ${data.nextStageName} 还需 ${data.xpToNext.toLocaleString()} 修为`;
    const ladderIndex = Math.max(
        0,
        REALM_LADDER.findIndex((realm) => realm.id === data.realmId),
    );

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                {/* ── 宫门 ── */}
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="shj-hero-eyebrow">Ming Gong</p>
                        <h1 className="font-brush mt-3 text-5xl text-[#edede6] sm:text-6xl">命宫</h1>
                        <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#8a8a96]">修行进度与境界之路,皆在此宫</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {user?.admin ? (
                            <Link to="/admin/cultivation" className="inline-flex items-center gap-1.5 text-sm text-[#c9c4b9] transition-colors hover:text-[#f7f4ea]">
                                <Settings2 className="size-4" />
                                修炼管理
                            </Link>
                        ) : null}
                        <Link to="/image" className="inline-flex items-center gap-1.5 text-sm text-[#c9c4b9] transition-colors hover:text-[#f7f4ea]">
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

                {/* ── 主殿:当前境界 ── */}
                <section className="shj-panel relative mt-8 overflow-hidden !rounded-xl" aria-label={`${data.realmName} 境界意境`}>
                    <img
                        src={realmHero.imageSrc}
                        alt={`${data.realmName} 境界意境`}
                        width={1600}
                        height={900}
                        className="h-[340px] w-full object-cover sm:h-[380px]"
                        style={{ objectPosition: realmHero.imagePosition || "center" }}
                        decoding="async"
                        fetchPriority="high"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e12] via-[#0e0e12]/45 to-transparent" aria-hidden />
                    <div className="absolute inset-0 flex flex-col justify-between p-6 sm:p-8">
                        <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                                <ProfileAvatarImage
                                    src={avatarUrl}
                                    alt={`${data.displayName} 的头像`}
                                    fallback={data.displayName.slice(0, 1).toUpperCase()}
                                    width={48}
                                    height={48}
                                    loading="eager"
                                    fetchPriority="high"
                                    className={cn(
                                        "grid size-12 place-items-center overflow-hidden rounded-full border text-base font-semibold",
                                        isDouEmperor ? "border-[#c9a86a]/70 text-[#f0ead8]" : "border-[rgb(237_237_230/0.25)] text-[#edede6]",
                                        "bg-[#17171d]/80 backdrop-blur",
                                    )}
                                />
                                <Tooltip title="上传头像">
                                    <button
                                        type="button"
                                        className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-[rgb(237_237_230/0.25)] bg-[#23232c] text-[#c9c4b9] transition-colors hover:text-[#f7f4ea]"
                                        onClick={() => avatarInputRef.current?.click()}
                                        disabled={avatarUploading}
                                        aria-label="上传头像"
                                    >
                                        {avatarUploading ? <LoaderCircle className="size-3 animate-spin" /> : <Camera className="size-3" />}
                                    </button>
                                </Tooltip>
                                <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(event) => void uploadAvatar(event)} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[#edede6]">{data.displayName}</div>
                                <div className="mt-0.5 text-xs text-[#edede6]/50">UID {data.userId.slice(0, 8)}</div>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 text-xs tracking-[0.3em] text-[#c9a86a]">
                                <RealmIcon iconKey={data.iconKey} className="size-4" />
                                当前境界
                            </div>
                            <h2 className="font-brush mt-3 text-5xl leading-none text-[#f0ead8] [text-shadow:0_2px_24px_rgb(0_0_0/0.55)] sm:text-6xl">{stageLabel}</h2>
                            <p className="font-display mt-3 max-w-xl text-sm leading-6 text-[#edede6]/75">{realmHero.description}</p>

                            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                                {emperorFinalStage ? (
                                    <p className="font-display text-base tracking-[0.1em] text-[#c9a86a]">手握日月摘星辰 世间无我这般人！</p>
                                ) : finalStage ? (
                                    <div>
                                        <div className="inline-flex items-center gap-2 text-sm text-[#c9c4b9]">
                                            <CheckCircle2 className="size-4 text-[#3e5c56]" />
                                            当前主题已完成,持续创作会沉淀累计修为
                                        </div>
                                    </div>
                                ) : (
                                    <div className="min-w-0 max-w-xl flex-1">
                                        <div
                                            className="h-[3px] overflow-hidden rounded-full bg-[rgb(237_237_230/0.12)]"
                                            role="progressbar"
                                            aria-label="本阶段修为进度"
                                            aria-valuemin={0}
                                            aria-valuemax={data.requiredXp}
                                            aria-valuenow={Math.min(data.currentXp, data.requiredXp)}
                                        >
                                            <div className="h-full rounded-full bg-gradient-to-r from-[#8a6a2f] via-[#c9a86a] to-[#f0d9a0] transition-[width] duration-700" style={{ width: `${cultivationPercent}%` }} />
                                        </div>
                                        <p className="mt-2 text-xs text-[#edede6]/70">{nextStageSummary}</p>
                                    </div>
                                )}
                                <Link to="/image" className="shj-cta-glow inline-flex items-center gap-2 rounded-md bg-[#d8402a] px-6 py-3 text-sm font-medium tracking-[0.15em] text-[#fff7ee] transition-colors duration-300 hover:bg-[#ee5038]">
                                    <ImagePlus className="size-4" />
                                    继续创作
                                    <ArrowUpRight className="size-4" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
                    <div className="min-w-0 space-y-6">
                        {/* ── 今日修行 ── */}
                        <section className="shj-panel p-6" aria-label="今日修行">
                            <div className="grid gap-6 sm:grid-cols-2">
                                {emperorFinalStage ? (
                                    <div>
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="font-display text-sm tracking-[0.1em] text-[#edede6]">修为成长</span>
                                            <span className="text-sm text-[#8a8a96]">累计 {data.totalXp.toLocaleString()}</span>
                                        </div>
                                        <p className="font-display mt-3 text-sm leading-6 text-[#c9a86a]">已登临斗帝之境,天地已无更高境界,创作永无止境。</p>
                                    </div>
                                ) : (
                                    <MetricBlock
                                        label="修为成长"
                                        value={finalStage ? "最高境界" : `${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()}`}
                                        helper={finalStage ? "已抵达该主题定义的最高阶段" : data.pendingStageId ? "修为已满足突破条件,等待审批" : `还需 ${data.xpToNext.toLocaleString()} 修为`}
                                        percent={cultivationPercent}
                                        complete={finalStage}
                                    />
                                )}
                                <MetricBlock
                                    label="今日创作"
                                    value={data.unlimited ? "不限次数" : `剩余 ${remainingQuota} 次`}
                                    helper={data.unlimited ? `今日已使用 ${data.usedToday} 次` : `已使用 ${data.usedToday} / ${data.dailyLimit} 次${data.reservedToday ? ` · ${data.reservedToday} 次生成中占用` : ""}`}
                                    percent={quotaPercent}
                                    quota
                                />
                            </div>
                        </section>

                        {/* ── 修行印记 ── */}
                        <section className="grid grid-cols-3 gap-4" aria-label="创作统计">
                            <StatBlock label="累计修为" value={data.totalXp.toLocaleString()} />
                            <StatBlock label="累计生图" value={data.totalImages.toLocaleString()} />
                            <StatBlock label="创作天数" value={`${data.activeDays} 天`} />
                        </section>

                        {data.pendingStageId || data.publicMessage ? (
                            <section className="space-y-3" aria-live="polite">
                                {data.pendingStageId ? <NoticeBlock label="突破状态" text="修为已达到要求,下一阶段正在等待管理员审批。" accent /> : null}
                                {data.publicMessage ? <NoticeBlock label="来自管理员" text={data.publicMessage} /> : null}
                            </section>
                        ) : null}

                        {data.capabilities.length ? (
                            <section className="shj-panel flex flex-wrap items-baseline gap-x-3 gap-y-1 p-5" aria-label="已开放能力">
                                <span className="font-display text-sm tracking-[0.1em] text-[#c9a86a]">能力权限</span>
                                <p className="text-sm text-[#c9c4b9]">
                                    已开放:{data.capabilities.slice(0, 3).map(cultivationCapabilityLabel).join("、")}
                                    {data.capabilities.length > 3 ? ` 等 ${data.capabilities.length} 项能力` : ""}
                                </p>
                            </section>
                        ) : null}
                    </div>

                    {/* ── 境界阶梯 ── */}
                    <aside className="shj-panel h-fit p-6 lg:sticky lg:top-20" aria-label="境界阶梯">
                        <h2 className="font-display text-lg tracking-[0.15em] text-[#edede6]">境界阶梯</h2>
                        <p className="mt-1 text-xs text-[#8a8a96]">越过一境,天地一变</p>
                        <div className="shj-ladder mt-5">
                            {[...REALM_LADDER].reverse().map((realm) => {
                                const index = REALM_LADDER.findIndex((item) => item.id === realm.id);
                                const state = index < ladderIndex ? "is-passed" : index === ladderIndex ? "is-current" : "is-future";
                                return (
                                    <div key={realm.id} className={cn("shj-ladder-item", state)}>
                                        <span className="shj-ladder-dot" aria-hidden />
                                        <span className={cn("font-display", state === "is-current" ? "text-base" : "text-sm")}>{realm.name}</span>
                                        {state === "is-current" ? <span className="shj-seal ml-auto !px-1.5 !py-1 !text-[11px]">汝在此处</span> : null}
                                    </div>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}

function MetricBlock({ label, value, helper, percent, complete, quota }: { label: string; value: string; helper: string; percent: number; complete?: boolean; quota?: boolean }) {
    return (
        <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-display text-sm tracking-[0.1em] text-[#edede6]">{label}</span>
                <span className="text-sm text-[#c9c4b9]">
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
                <div className="mt-3 inline-flex items-center gap-2 text-sm text-[#c9c4b9]">
                    <CheckCircle2 className="size-4 text-[#3e5c56]" />
                    已抵达最高阶段
                </div>
            ) : (
                <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-[rgb(237_237_230/0.12)]" aria-hidden>
                    <div className="h-full rounded-full bg-gradient-to-r from-[#8a6a2f] via-[#c9a86a] to-[#f0d9a0]" style={{ width: `${percent}%` }} />
                </div>
            )}
            <p className="mt-2 text-xs leading-5 text-[#8a8a96]">{helper}</p>
        </div>
    );
}

function StatBlock({ label, value }: { label: string; value: string }) {
    return (
        <div className="shj-panel p-5">
            <div className="text-xs tracking-[0.1em] text-[#8a8a96]">{label}</div>
            <div className="font-display mt-2 truncate text-2xl text-[#edede6]" title={value}>
                {value}
            </div>
        </div>
    );
}

function NoticeBlock({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
    return (
        <div className={cn("shj-panel p-5", accent && "!border-[rgb(201_168_106/0.4)]")}>
            <div className="font-display text-sm tracking-[0.1em] text-[#edede6]">{label}</div>
            <p className="mt-1 text-sm leading-6 text-[#c9c4b9]">{text}</p>
        </div>
    );
}

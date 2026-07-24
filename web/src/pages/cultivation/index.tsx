import { App, Button, Progress, Result, Skeleton, Tooltip } from "antd";
import { ArrowRight, Camera, Infinity as InfinityIcon, LoaderCircle, Settings2 } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { cultivationProgressPercent, cultivationStageLabel } from "@/features/cultivation/utils";
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
    const admin = Boolean(user?.admin);
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

    if (isLoading)
        return (
            <div className="mx-auto max-w-6xl p-6">
                <Skeleton active />
            </div>
        );
    if (isError || !data) return <Result status="warning" title="修炼信息暂时无法加载" extra={<Button onClick={() => void refetch()}>重新加载</Button>} />;

    const finalStage = !data.nextStageName;
    const cultivationPercent = finalStage ? 100 : cultivationProgressPercent(data.currentXp, data.requiredXp, Boolean(data.pendingStageId));
    const stageLabel = cultivationStageLabel(data.realmName, data.stageName);
    const accentColor = readableRealmColor(data.color);
    const avatarUrl = data.avatarUrl || user?.avatarUrl || "";
    const remainingQuota = data.unlimited ? null : Math.max(0, data.remainingToday || 0);
    const quotaPercent = data.unlimited ? 100 : data.dailyLimit && remainingQuota !== null ? Math.max(0, Math.min(100, Math.round((remainingQuota / data.dailyLimit) * 100))) : 0;

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium text-stone-500 dark:text-stone-400">我的修炼</div>
                        <h1 className="mt-1 text-2xl font-semibold text-stone-950 dark:text-stone-100">创作成长概览</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {admin ? (
                            <Link to="/admin/cultivation">
                                <Button icon={<Settings2 className="size-4" />}>修炼管理</Button>
                            </Link>
                        ) : null}
                        <Link to="/image">
                            <Button type="primary" icon={<ArrowRight className="size-4" />}>
                                继续创作
                            </Button>
                        </Link>
                    </div>
                </header>

                <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
                    <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-10">
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-4">
                                <div className="relative shrink-0">
                                    <div className="grid size-16 place-items-center overflow-hidden rounded-full border bg-stone-50 text-xl font-semibold dark:bg-stone-900" style={{ borderColor: `${accentColor}66`, color: accentColor }}>
                                        {avatarUrl ? <img src={avatarUrl} alt={`${data.displayName} 的头像`} className="size-full object-cover" /> : data.displayName.slice(0, 1).toUpperCase()}
                                    </div>
                                    <Tooltip title="上传头像">
                                        <button
                                            type="button"
                                            className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-stone-400 hover:text-stone-950 disabled:cursor-wait disabled:opacity-70 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-stone-100"
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
                                    <h2 className="truncate text-xl font-semibold text-stone-950 dark:text-stone-100">{data.displayName}</h2>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500 dark:text-stone-400">
                                        <span>UID {data.userId.slice(0, 8)}</span>
                                        <span className="hidden text-stone-300 dark:text-stone-700 sm:inline">/</span>
                                        <span>{stageLabel}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 space-y-5">
                                <ProgressRow
                                    label="修为进度"
                                    value={finalStage ? `${data.currentXp.toLocaleString()} 修为` : `${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()}`}
                                    helper={finalStage ? "已达当前主题最高境界" : data.pendingStageId ? "等待管理员审批突破" : `距离下一星还需 ${data.xpToNext.toLocaleString()} 修为`}
                                    percent={cultivationPercent}
                                    color={accentColor}
                                />
                                <ProgressRow
                                    label="今日额度"
                                    value={data.unlimited ? "不限次数" : `${remainingQuota} / ${data.dailyLimit ?? 0} 次剩余`}
                                    helper={data.unlimited ? `今日已使用 ${data.usedToday} 次` : `今日已使用 ${data.usedToday} 次 · 并发上限 ${data.maxConcurrency}`}
                                    percent={quotaPercent}
                                    color={accentColor}
                                />
                            </div>

                            {data.pendingStageId ? <div className="mt-6 border-l-2 border-amber-400 pl-3 text-sm leading-6 text-amber-900 dark:text-amber-200">修为已达到下一境界要求，正在等待管理员审批。</div> : null}
                            {data.publicMessage ? <div className="mt-5 border-l-2 border-stone-300 pl-3 text-sm leading-6 text-stone-600 dark:border-stone-700 dark:text-stone-300">{data.publicMessage}</div> : null}
                        </div>

                        <RealmPresentation stageLabel={stageLabel} color={accentColor} iconKey={data.iconKey} finalStage={finalStage} />
                    </div>

                    <div className="grid border-t border-stone-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-800">
                        <Metric label="当前境界" value={stageLabel} accent={accentColor} />
                        <Metric label="今日剩余" value={data.unlimited ? "不限" : `${remainingQuota} 次`} />
                        <Metric label="累计生图" value={data.totalImages.toLocaleString()} />
                        <Metric label="累计修炼天数" value={`${data.activeDays} 天`} />
                    </div>
                </section>
            </div>
        </main>
    );
}

function ProgressRow({ label, value, helper, percent, color }: { label: string; value: string; helper: string; percent: number; color: string }) {
    return (
        <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-stone-800 dark:text-stone-200">{label}</span>
                <span className="text-stone-600 dark:text-stone-300">{value}</span>
            </div>
            <Progress percent={percent} showInfo={false} strokeColor={color} trailColor="rgba(120,113,108,.14)" size="small" />
            <div className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">{helper}</div>
        </div>
    );
}

function RealmPresentation({ stageLabel, color, iconKey, finalStage }: { stageLabel: string; color: string; iconKey: string; finalStage: boolean }) {
    return (
        <div className="relative hidden min-h-56 items-center justify-center overflow-hidden border-l border-stone-200 pl-8 dark:border-stone-800 lg:flex" style={{ color }}>
            <div className="absolute size-52 rounded-full border opacity-20" style={{ borderColor: color }} />
            <div className="absolute size-36 rounded-full border opacity-30" style={{ borderColor: color }} />
            <div className="relative grid size-20 place-items-center rounded-full border bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-50" style={{ borderColor: `${color}80`, boxShadow: `0 0 0 8px ${color}12` }}>
                <RealmIcon iconKey={iconKey} className="size-9" />
            </div>
            <div className="absolute bottom-3 left-8 right-0 text-center">
                <div className="text-sm font-medium text-stone-800 dark:text-stone-200">{stageLabel}</div>
                <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{finalStage ? "当前主题最高境界" : "持续创作，稳步积累修为"}</div>
            </div>
        </div>
    );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
    return (
        <div className="min-w-0 border-stone-200 px-5 py-5 first:border-l-0 sm:border-l sm:[&:nth-child(3)]:border-l-0 lg:[&:nth-child(3)]:border-l dark:border-stone-800">
            <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-lg font-semibold text-stone-950 dark:text-stone-100" title={value}>
                {accent ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} /> : null}
                <span className="truncate">{value}</span>
            </div>
        </div>
    );
}

function readableRealmColor(color: string) {
    const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) return "#38bdf8";
    const hex = match[1].length === 3 ? match[1].split("").map((value) => `${value}${value}`).join("") : match[1];
    const [red, green, blue] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((value) => Number.parseInt(value, 16) / 255);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luminance < 0.2 ? "#38bdf8" : color;
}

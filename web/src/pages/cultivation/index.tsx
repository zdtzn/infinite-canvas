import { Button, Progress, Result, Skeleton } from "antd";
import { ArrowRight, Infinity as InfinityIcon, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";

import { RealmIcon } from "@/features/cultivation/realm-icon";
import { useCultivationProfile } from "@/features/cultivation/queries";
import { cultivationProgressPercent, cultivationStageLabel } from "@/features/cultivation/utils";
import { useUserStore } from "@/stores/use-user-store";

export default function CultivationPage() {
    const { data, isLoading, isError, refetch } = useCultivationProfile();
    const admin = useUserStore((state) => Boolean(state.user?.admin));
    if (isLoading)
        return (
            <div className="mx-auto max-w-5xl p-6">
                <Skeleton active />
            </div>
        );
    if (isError || !data) return <Result status="warning" title="修炼信息暂时无法加载" extra={<Button onClick={() => void refetch()}>重新加载</Button>} />;
    const finalStage = !data.nextStageName;
    const percent = finalStage ? 100 : cultivationProgressPercent(data.currentXp, data.requiredXp, Boolean(data.pendingStageId));
    const stageLabel = cultivationStageLabel(data.realmName, data.stageName);

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-5xl px-6 py-10">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-8 dark:border-stone-800">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="grid size-14 shrink-0 place-items-center rounded-lg border bg-stone-50 text-xl font-semibold dark:bg-stone-900" style={{ borderColor: `${data.color}55`, color: data.color }}>
                            {data.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm text-stone-500 dark:text-stone-400">我的修炼</div>
                            <h1 className="mt-1 truncate text-2xl font-semibold text-stone-950 dark:text-stone-100">{data.displayName}</h1>
                        </div>
                    </div>
                    {admin ? (
                        <Link to="/admin/cultivation">
                            <Button icon={<Settings2 className="size-4" />}>修炼管理</Button>
                        </Link>
                    ) : null}
                </header>

                <section className="grid gap-8 py-9 md:grid-cols-[minmax(0,1.5fr)_minmax(240px,.7fr)]">
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-md" style={{ background: `${data.color}15`, color: data.color }}>
                                <RealmIcon iconKey={data.iconKey} className="size-5" />
                            </span>
                            <div>
                                <div className="text-xl font-semibold">{stageLabel}</div>
                                <div className="mt-1 text-sm text-stone-500">累计修为 {data.totalXp.toLocaleString()}</div>
                            </div>
                        </div>
                        <div className="mt-7">
                            <div className="mb-2 flex justify-between gap-4 text-sm">
                                <span>{finalStage ? `当前修为 ${data.currentXp.toLocaleString()}` : `当前修为 ${data.currentXp.toLocaleString()} / ${data.requiredXp.toLocaleString()}`}</span>
                                <span className="text-stone-500">{finalStage ? "已达当前主题最高境界" : data.pendingStageId ? "待突破" : `还需 ${data.xpToNext.toLocaleString()}`}</span>
                            </div>
                            <Progress percent={percent} showInfo={false} strokeColor={data.color} trailColor="rgba(120,113,108,.15)" />
                        </div>
                        {data.pendingStageId ? (
                            <div className="mt-5 rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">修为已经达到下一境界要求，正在等待管理员审批。</div>
                        ) : null}
                        {data.publicMessage ? <div className="mt-5 border-l-2 border-stone-300 pl-4 text-sm leading-6 text-stone-600 dark:border-stone-700 dark:text-stone-300">{data.publicMessage}</div> : null}
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                        <div className="text-sm font-medium">今日额度</div>
                        <div className="mt-3 flex items-end gap-2">
                            <span className="text-3xl font-semibold">{data.unlimited ? <InfinityIcon className="size-8" /> : data.remainingToday}</span>
                            {!data.unlimited ? <span className="pb-1 text-sm text-stone-500">次剩余</span> : null}
                        </div>
                        <div className="mt-4 text-xs leading-6 text-stone-500">
                            已使用 {data.usedToday} 次 · 并发上限 {data.maxConcurrency}
                        </div>
                        <Link to="/image" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-stone-950 hover:text-stone-600 dark:text-stone-100">
                            <span>继续创作</span>
                            <ArrowRight className="size-4" />
                        </Link>
                    </div>
                </section>

                <section className="grid border-y border-stone-200 py-7 sm:grid-cols-3 dark:border-stone-800">
                    <Metric label="累计成功图片" value={data.totalImages.toLocaleString()} />
                    <Metric label="累计修炼天数" value={`${data.activeDays} 天`} />
                    <Metric label="今日已使用" value={`${data.usedToday} 次`} />
                </section>
            </div>
        </main>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-stone-200 px-5 py-3 first:pl-0 sm:border-l sm:first:border-l-0 dark:border-stone-800">
            <div className="text-sm text-stone-500">{label}</div>
            <div className="mt-2 text-xl font-semibold">{value}</div>
        </div>
    );
}

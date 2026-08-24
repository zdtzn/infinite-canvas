import { App, Badge, Button, Drawer, Empty, Progress, Tag, Tooltip } from "antd";
import { Ban, CheckCircle2, CircleAlert, ListTodo, RotateCcw, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { formatDuration } from "@/lib/image-utils";
import { preloadRoute } from "@/lib/route-loaders";
import { cancelServerJob, fetchServerJobs, retryServerJob, type ServerJob } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { taskProgressProps } from "./task-progress";

const RECENT_SUCCESS_MS = 60_000;
const ACTIONABLE_FAILURE_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIONABLE_FAILURES = 3;

const statusColors: Record<ServerJob["status"], string> = { queued: "default", running: "processing", succeeded: "success", failed: "error", canceled: "default" };

export function TaskCenter() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [jobs, setJobs] = useState<ServerJob[]>([]);
    const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);
    const [loadingId, setLoadingId] = useState("");
    const retryKeys = useRef(new Map<string, string>());
    const userId = useUserStore((state) => state.user?.id || "");
    const activeJobs = useMemo(() => jobs.filter(isActiveJob).sort(sortJobs), [jobs]);
    const activeCount = activeJobs.length;
    const recentSuccessJobs = useMemo(() => {
        const now = Date.now();
        return jobs
            .filter((job) => job.status === "succeeded" && now - (job.finishedAt || job.createdAt) <= RECENT_SUCCESS_MS)
            .sort(sortJobs)
            .slice(0, 2);
    }, [jobs, open]);
    const actionableJobs = useMemo(() => {
        const now = Date.now();
        return jobs
            .filter((job) => !dismissedJobIds.includes(job.id) && (job.status === "failed" || job.status === "canceled") && now - (job.finishedAt || job.createdAt) <= ACTIONABLE_FAILURE_MS)
            .sort(sortJobs)
            .slice(0, MAX_ACTIONABLE_FAILURES);
    }, [dismissedJobIds, jobs, open]);

    const refresh = async (silent = true) => {
        const expectedUserId = userId;
        if (!expectedUserId) return;
        try {
            const items = (await fetchServerJobs(expectedUserId)).items;
            if (useUserStore.getState().user?.id === expectedUserId) setJobs(items);
        } catch (error) {
            if (!silent) message.error(error instanceof Error ? error.message : "生成进度加载失败");
        }
    };

    useEffect(() => {
        if (!PUBLIC_MODE) return;
        if (!userId) {
            setJobs([]);
            return;
        }
        let disposed = false;
        let timer: number | undefined;
        const delay = activeCount ? 3000 : open ? 15000 : 30000;
        const schedule = () => {
            if (disposed || document.hidden) return;
            timer = window.setTimeout(() => void poll(), delay);
        };
        const poll = async () => {
            if (disposed || document.hidden) return;
            await refresh();
            schedule();
        };
        const handleVisibilityChange = () => {
            if (timer) window.clearTimeout(timer);
            timer = undefined;
            if (!document.hidden) void poll();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        if (!document.hidden) {
            if (open) void poll();
            else timer = window.setTimeout(() => void poll(), 1_000);
        }
        return () => {
            disposed = true;
            if (timer) window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [userId, activeCount, open]);

    useEffect(() => setDismissedJobIds([]), [userId]);

    if (!PUBLIC_MODE) return null;

    const act = async (job: ServerJob, action: "cancel" | "retry") => {
        const expectedUserId = userId;
        if (!expectedUserId) return;
        setLoadingId(job.id);
        try {
            if (action === "cancel") await cancelServerJob(job.id, expectedUserId);
            if (action === "retry") {
                const retryKey = retryKeys.current.get(job.id) || nanoid();
                retryKeys.current.set(job.id, retryKey);
                await retryServerJob(job.id, expectedUserId, retryKey);
                retryKeys.current.delete(job.id);
                setDismissedJobIds((ids) => (ids.includes(job.id) ? ids : [...ids, job.id]));
            }
            await refresh(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setLoadingId("");
        }
    };

    const openJob = (job: ServerJob) => {
        if (job.source?.route) {
            void preloadRoute(job.source.route);
            navigate(job.source.route);
        }
        setOpen(false);
    };
    const sections = [
        { key: "active", title: "进行中", icon: <ListTodo className="size-4" />, jobs: activeJobs },
        { key: "actionable", title: "需要处理", icon: <CircleAlert className="size-4" />, jobs: actionableJobs },
        { key: "completed", title: "刚刚完成", icon: <CheckCircle2 className="size-4" />, jobs: recentSuccessJobs },
    ].filter((section) => section.jobs.length);

    return (
        <>
            <Tooltip title="生成进度">
                <Badge count={activeCount} size="small" offset={[-1, 2]}>
                    <button type="button" className="inline-flex size-7 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" onClick={() => setOpen(true)} aria-label="生成进度">
                        <ListTodo className="size-4" />
                    </button>
                </Badge>
            </Tooltip>
            <Drawer open={open} width="min(400px, 100vw)" title="生成进度" onClose={() => setOpen(false)} styles={{ body: { padding: 16 } }}>
                <div className="space-y-5">
                    {sections.map((section) => (
                        <section key={section.key} aria-label={section.title}>
                            <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium">
                                <span className="flex items-center gap-2">
                                    {section.icon}
                                    {section.title}
                                </span>
                                <span className="text-xs font-normal text-stone-400">{section.jobs.length}</span>
                            </div>
                            <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                                {section.jobs.map((job) => (
                                    <TaskItem
                                        key={job.id}
                                        job={job}
                                        loading={loadingId === job.id}
                                        onOpen={() => openJob(job)}
                                        onAction={(action) => void act(job, action)}
                                        onDismiss={() => setDismissedJobIds((ids) => (ids.includes(job.id) ? ids : [...ids, job.id]))}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                    {!sections.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无进行中的生成" /> : null}
                    {actionableJobs.length ? <p className="text-xs leading-5 text-stone-400">失败任务仅保留最近需要处理的项目，完整生成记录可在各工作台的“太古遗迹”中查看。</p> : null}
                </div>
            </Drawer>
        </>
    );
}

function TaskItem({ job, loading, onOpen, onAction, onDismiss }: { job: ServerJob; loading: boolean; onOpen: () => void; onAction: (action: "cancel" | "retry") => void; onDismiss: () => void }) {
    const active = isActiveJob(job);
    const progress = taskProgressProps(job.status);
    const duration = (job.finishedAt || Date.now()) - (job.startedAt || job.createdAt);

    return (
        <div className="py-3">
            <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
                    <div className="truncate text-sm font-medium">{jobWorkspaceLabel(job)}</div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                        <span className="max-w-full truncate">{job.model || "默认模型"}</span>
                        <span>{job.count} 张</span>
                        <span>{formatDuration(Math.max(0, duration))}</span>
                    </div>
                </button>
                <Tag className="m-0 shrink-0" color={statusColors[job.status]}>
                    {jobStatusLabel(job)}
                </Tag>
            </div>
            {progress ? (
                job.result && job.result.successCount > 0 ? (
                    <Progress className="mt-2" percent={Math.round((job.result.successCount / Math.max(1, job.count)) * 100)} size="small" showInfo={false} status="active" />
                ) : (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="status" aria-label={job.status === "queued" ? "任务正在排队" : "任务正在生成"}>
                        <div className="animate-[shimmer_1.6s_ease-in-out_infinite] h-full w-1/3 rounded-full bg-stone-400 dark:bg-stone-400" style={{ backgroundImage: "linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)" }} />
                    </div>
                )
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-3">
                <span className="truncate text-xs text-stone-400">{job.size || job.quality || "参数已提交"}</span>
                <div className="flex shrink-0 items-center gap-1">
                    {active ? (
                        <Tooltip title="取消生成">
                            <Button aria-label="取消生成" type="text" danger size="small" icon={<Ban className="size-3.5" />} loading={loading} onClick={() => onAction("cancel")} />
                        </Tooltip>
                    ) : null}
                    {job.status === "failed" || job.status === "canceled" ? (
                        <Tooltip title="重试">
                            <Button aria-label="重试" type="text" size="small" icon={<RotateCcw className="size-3.5" />} loading={loading} onClick={() => onAction("retry")} />
                        </Tooltip>
                    ) : null}
                    {job.status === "failed" || job.status === "canceled" ? (
                        <Tooltip title="暂时隐藏">
                            <Button aria-label="暂时隐藏" type="text" size="small" icon={<X className="size-3.5" />} onClick={onDismiss} />
                        </Tooltip>
                    ) : null}
                </div>
            </div>
            {job.error ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-red-500">{friendlyErrorMessage(job.error)}</div> : null}
        </div>
    );
}

function isActiveJob(job: ServerJob) {
    return job.status === "queued" || job.status === "running";
}

function sortJobs(a: ServerJob, b: ServerJob) {
    return (b.finishedAt || b.startedAt || b.createdAt) - (a.finishedAt || a.startedAt || a.createdAt);
}

function jobWorkspaceLabel(job: ServerJob) {
    if (job.source?.route === "/image") return "丹青台";
    if (job.source?.route === "/video") return "流光阁";
    if (job.source?.route === "/product-lab") return job.source.label || "商品幻境";
    if (job.source?.route?.startsWith("/canvas")) return "洞天画布";
    return job.source?.label || "生成任务";
}

function jobStatusLabel(job: ServerJob) {
    if (job.status === "queued") return "排队中";
    if (job.status === "running") return job.phase === "waiting_upstream" ? "生成中" : "提交中";
    if (job.status === "succeeded") return "已完成";
    if (job.status === "failed") return "待重试";
    return "已取消";
}

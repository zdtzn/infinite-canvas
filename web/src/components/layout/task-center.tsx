import { App, Badge, Button, Drawer, Empty, Progress, Tag, Tooltip } from "antd";
import { Ban, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { cancelServerJob, fetchServerJobs, removeServerJob, retryServerJob, type ServerJob } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { formatDuration } from "@/lib/image-utils";
import { useUserStore } from "@/stores/use-user-store";
import { taskProgressProps } from "./task-progress";

const statusColors: Record<ServerJob["status"], string> = { queued: "default", running: "processing", succeeded: "success", failed: "error", canceled: "default" };

export function TaskCenter() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [jobs, setJobs] = useState<ServerJob[]>([]);
    const [loadingId, setLoadingId] = useState("");
    const retryKeys = useRef(new Map<string, string>());
    const userId = useUserStore((state) => state.user?.id || "");
    const activeCount = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "running").length, [jobs]);

    const refresh = async (silent = true) => {
        const expectedUserId = userId;
        if (!expectedUserId) return;
        try {
            const items = (await fetchServerJobs(expectedUserId)).items;
            if (useUserStore.getState().user?.id === expectedUserId) setJobs(items);
        } catch (error) {
            if (!silent) message.error(error instanceof Error ? error.message : "任务列表加载失败");
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
        if (!document.hidden) void poll();
        return () => {
            disposed = true;
            if (timer) window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [userId, activeCount, open]);

    if (!PUBLIC_MODE) return null;

    const act = async (job: ServerJob, action: "cancel" | "retry" | "remove") => {
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
            }
            if (action === "remove") {
                retryKeys.current.delete(job.id);
                await removeServerJob(job.id, expectedUserId);
            }
            await refresh(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setLoadingId("");
        }
    };

    return (
        <>
            <Tooltip title="任务中心">
                <Badge count={activeCount} size="small" offset={[-1, 2]}>
                    <button type="button" className="inline-flex size-7 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" onClick={() => setOpen(true)} aria-label="任务中心">
                        <ListTodo className="size-4" />
                    </button>
                </Badge>
            </Tooltip>
            <Drawer open={open} width="min(440px, 100vw)" title="生图任务中心" onClose={() => setOpen(false)} styles={{ body: { padding: 16 } }}>
                <div className="space-y-2">
                    {jobs.map((job) => {
                        const active = job.status === "queued" || job.status === "running";
                        const progress = taskProgressProps(job.status);
                        const duration = (job.finishedAt || Date.now()) - (job.startedAt || job.createdAt);
                        return (
                            <div key={job.id} className="border-b border-stone-200 py-3 last:border-b-0 dark:border-stone-800">
                                <div className="flex items-start justify-between gap-3">
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 text-left"
                                        onClick={() => {
                                            if (job.source?.route) navigate(job.source.route);
                                            setOpen(false);
                                        }}
                                    >
                                        <div className="truncate text-sm font-medium">{job.source?.label || job.prompt || "生图任务"}</div>
                                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{job.prompt}</div>
                                    </button>
                                    <Tag className="m-0 shrink-0" color={statusColors[job.status]}>
                                        {jobStatusLabel(job)}
                                    </Tag>
                                </div>
                                {progress ? (
                                    job.result && job.result.successCount > 0 ? (
                                        <Progress
                                            className="mt-2"
                                            percent={Math.round((job.result.successCount / job.count) * 100)}
                                            size="small"
                                            showInfo={false}
                                            status="active"
                                        />
                                    ) : (
                                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="status" aria-label={job.status === "queued" ? "任务正在排队" : "任务正在生成"}>
                                            <div className="animate-[shimmer_1.6s_ease-in-out_infinite] h-full w-1/3 rounded-full bg-stone-400 dark:bg-stone-400" style={{ backgroundImage: "linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)" }} />
                                        </div>
                                    )
                                ) : null}
                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-stone-500">
                                    <span>{job.count} 张 · {formatDuration(Math.max(0, duration))} · 任务 {job.id.slice(0, 8)}</span>
                                    <div className="flex items-center gap-1">
                                        {active ? <Button type="text" danger size="small" icon={<Ban className="size-3.5" />} loading={loadingId === job.id} onClick={() => void act(job, "cancel")} /> : null}
                                        {job.status === "failed" || job.status === "canceled" ? <Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} loading={loadingId === job.id} onClick={() => void act(job, "retry")} /> : null}
                                        {!active ? <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} loading={loadingId === job.id} onClick={() => void act(job, "remove")} /> : null}
                                    </div>
                                </div>
                                {job.error ? <div className="mt-2 text-xs leading-5 text-red-500">{friendlyErrorMessage(job.error)}</div> : null}
                            </div>
                        );
                    })}
                    {!jobs.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" /> : null}
                </div>
            </Drawer>
        </>
    );
}

function jobStatusLabel(job: ServerJob) {
    if (job.status === "queued") return "排队中";
    if (job.status === "running") return job.phase === "waiting_upstream" ? "上游生成中" : "正在提交";
    if (job.status === "succeeded") return "已完成";
    if (job.status === "failed") return "失败";
    return "已取消";
}

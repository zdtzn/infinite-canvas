import { App, Badge, Button, Drawer, Empty, Image, Progress, Tag, Tooltip } from "antd";
import { Ban, CheckCircle2, CircleAlert, ListTodo, RotateCcw, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { recentImageResults } from "./task-results";
import { useNavigate } from "react-router-dom";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { friendlyErrorMessage, userFacingErrorMessage } from "@/lib/friendly-error";
import { generationFailureFeedback } from "@/features/cultivation/generation-messages";
import { formatDuration } from "@/lib/image-utils";
import { preloadRoute } from "@/lib/route-loaders";
import { cancelServerJob, fetchServerJobs, retryServerJob, type ServerJob } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { taskProgressProps } from "./task-progress";
import { useVideoTaskStore, videoTaskOwner, videoTasks } from "@/stores/use-video-task-store";
import { isActiveVideoTask, videoTaskLabel, videoTaskPhase, type VideoGenerationLog } from "@/services/video-task-model";

const RECENT_SUCCESS_MS = 60_000;
const ACTIONABLE_FAILURE_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIONABLE_FAILURES = 3;

const statusColors: Record<ServerJob["status"], string> = { queued: "default", running: "processing", succeeded: "success", failed: "error", canceled: "default" };

export function TaskCenter() {
    const userId = useUserStore((state) => state.user?.id || "");
    return <TaskCenterSession key={userId} userId={userId} />;
}

function TaskCenterSession({ userId }: { userId: string }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [expandedJobId, setExpandedJobId] = useState("");
    const lifetime = useRef({ active: false });
    useEffect(() => {
        const session = { active: true };
        lifetime.current = session;
        return () => { session.active = false; };
    }, []);
    const taskQuery = useQuery({
        queryKey: ["image-tasks", userId],
        queryFn: ({ signal }) => fetchServerJobs(userId, signal),
        enabled: PUBLIC_MODE && Boolean(userId),
        staleTime: 0,
        refetchOnWindowFocus: "always",
        refetchOnReconnect: "always",
        refetchInterval: (query) => query.state.data?.items.some((job) => isActiveJob(job) || job.result?.recoveryPending) ? 3000 : open ? 15000 : 30000,
        refetchIntervalInBackground: false,
    });
    const jobs = taskQuery.data?.items || [];
    const refresh = () => taskQuery.refetch({ cancelRefetch: false });
    useEffect(() => {
        if (!PUBLIC_MODE || !userId) return;
        const onFocus = () => { void taskQuery.refetch({ cancelRefetch: false }); };
        window.addEventListener("focus", onFocus);
        if (open) onFocus();
        return () => window.removeEventListener("focus", onFocus);
    }, [open, userId, taskQuery.refetch]);
    const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);
    const [loadingId, setLoadingId] = useState("");
    const retryKeys = useRef(new Map<string, string>());
    const activeJobs = useMemo(() => jobs.filter(isActiveJob).sort(sortJobs), [jobs]);
    const storedVideos = useVideoTaskStore((state) => state.logs);
    const videoOwner = useVideoTaskStore((state) => state.ownerId);
    const videoJobs = useMemo(() => (videoOwner === (PUBLIC_MODE ? userId : "local") ? storedVideos : []), [storedVideos, videoOwner, userId]);
    const activeVideos = videoJobs.filter(isActiveVideoTask);
    const actionableVideos = videoJobs.filter((job) => ["paused", "unknown", "failed", "canceled"].includes(videoTaskPhase(job)) && !dismissedJobIds.includes(`video:${job.id}`)).slice(0, MAX_ACTIONABLE_FAILURES);
    const completedVideos = videoJobs.filter((job) => videoTaskPhase(job) === "succeeded" && Date.now() - (job.updatedAt || job.createdAt) <= RECENT_SUCCESS_MS).slice(0, 2);
    const activeCount = activeJobs.length + activeVideos.length;

    useEffect(() => {
        void videoTasks.prepare(videoTaskOwner());
    }, [userId]);
    useEffect(() => {
        if (open) void videoTasks.refresh();
    }, [open, userId]);
    const recentSuccessJobs = useMemo(() => recentImageResults(jobs), [jobs]);
    const actionableJobs = useMemo(() => {
        const now = Date.now();
        return jobs
            .filter((job) => !dismissedJobIds.includes(job.id) && (job.status === "failed" || job.status === "canceled") && now - (job.finishedAt || job.createdAt) <= ACTIONABLE_FAILURE_MS)
            .sort(sortJobs)
            .slice(0, MAX_ACTIONABLE_FAILURES);
    }, [dismissedJobIds, jobs, open]);

    const act = async (job: ServerJob, action: "cancel" | "retry") => {
        const expectedUserId = userId;
        if (!expectedUserId) return;
        const session = lifetime.current;
        const isCurrent = () => session.active && useUserStore.getState().user?.id === expectedUserId;
        setLoadingId(job.id);
        try {
            if (action === "cancel") await cancelServerJob(job.id, expectedUserId);
            if (action === "retry") {
                const retryKey = retryKeys.current.get(job.id) || nanoid();
                retryKeys.current.set(job.id, retryKey);
                await retryServerJob(job.id, expectedUserId, retryKey);
                if (!isCurrent()) return;
                retryKeys.current.delete(job.id);
                setDismissedJobIds((ids) => (ids.includes(job.id) ? ids : [...ids, job.id]));
            }
            if (isCurrent()) await refresh();
        } catch (error) {
            if (isCurrent()) message.error(userFacingErrorMessage(error, "暂时无法确认操作结果，请刷新进度后再试"));
        } finally {
            if (isCurrent()) setLoadingId("");
        }
    };

    const openJob = (job: ServerJob) => {
        if (job.status === "succeeded") {
            setExpandedJobId((current) => current === job.id ? "" : job.id);
            return;
        }
        const route = job.source?.route;
        if (route && route !== "/product-lab" && route !== "/product-lab-batch") {
            void preloadRoute(route);
            navigate(route);
        }
        setOpen(false);
    };
    const openVideo = (job: VideoGenerationLog) => {
        videoTasks.select(job.id);
        void preloadRoute("/video");
        navigate("/video");
        setOpen(false);
    };
    const resumeVideo = (job: VideoGenerationLog) => {
        try {
            videoTasks.resume(job.id);
        } catch (error) {
            message.error(userFacingErrorMessage(error, "暂时无法查看视频进度，请稍后再试"));
        }
    };
    const sections = [
        { key: "active", title: "进行中", icon: <ListTodo className="size-4" />, jobs: activeJobs, videos: activeVideos },
        { key: "actionable", title: "需要处理", icon: <CircleAlert className="size-4" />, jobs: actionableJobs, videos: actionableVideos },
        { key: "completed", title: "最近完成", icon: <CheckCircle2 className="size-4" />, jobs: recentSuccessJobs, videos: completedVideos },
    ].filter((section) => section.jobs.length + section.videos.length);

    return (
        <>
            <Tooltip title="任务与结果">
                <Badge count={activeCount} size="small" offset={[-1, 2]}>
                    <button type="button" className="inline-flex size-7 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" onClick={() => setOpen(true)} aria-label="任务与结果">
                        <ListTodo className="size-4" />
                    </button>
                </Badge>
            </Tooltip>
            <Drawer open={open} width="min(400px, 100vw)" title="任务与结果" onClose={() => setOpen(false)} styles={{ body: { padding: 16 } }}>
                <div className="space-y-5">
                    {PUBLIC_MODE ? <div className="flex items-start justify-between gap-2">
                        <p className="text-xs leading-5 text-muted-foreground">已提交的生图可离开后回来查看；最近 20 条完成结果保留在这里。</p>
                        <Button size="small" type="text" loading={taskQuery.isFetching} onClick={() => void refresh()}>刷新</Button>
                    </div> : null}
                    {PUBLIC_MODE && taskQuery.isError ? <p role="alert" className="text-sm text-muted-foreground">暂时无法更新任务，请检查网络后点击刷新。已有记录仍保留。</p> : null}
                    {PUBLIC_MODE && taskQuery.isPending ? <p role="status" className="text-sm text-muted-foreground">正在找回任务……</p> : null}
                    {sections.map((section) => (
                        <section key={section.key} aria-label={section.title}>
                            <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium">
                                <span className="flex items-center gap-2">
                                    {section.icon}
                                    {section.title}
                                </span>
                                <span className="text-xs font-normal text-stone-400">{section.jobs.length + section.videos.length}</span>
                            </div>
                            <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                                {section.videos.map((job) => (
                                    <VideoTaskItem
                                        key={`video:${job.id}`}
                                        job={job}
                                        onOpen={() => openVideo(job)}
                                        onStop={() => videoTasks.stop(job.id)}
                                        onResume={() => resumeVideo(job)}
                                        onDismiss={() => setDismissedJobIds((ids) => [...ids, `video:${job.id}`])}
                                    />
                                ))}
                                {section.jobs.map((job) => (
                                    <TaskItem
                                        key={job.id}
                                        job={job}
                                        loading={loadingId === job.id}
                                        expanded={expandedJobId === job.id}
                                        onOpen={() => openJob(job)}
                                        onAction={(action) => void act(job, action)}
                                        onDismiss={() => setDismissedJobIds((ids) => (ids.includes(job.id) ? ids : [...ids, job.id]))}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                    {!sections.length && !(PUBLIC_MODE && (taskQuery.isPending || taskQuery.isError)) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成任务" /> : null}
                    {sections.length ? <p className="text-xs leading-5 text-stone-400">完整记录可在各工作台的“太古遗迹”中查看。</p> : null}
                </div>
            </Drawer>
        </>
    );
}

function TaskItem({ job, loading, expanded, onOpen, onAction, onDismiss }: { job: ServerJob; loading: boolean; expanded: boolean; onOpen: () => void; onAction: (action: "cancel" | "retry") => void; onDismiss: () => void }) {
    const active = isActiveJob(job);
    const progress = taskProgressProps(job.status);
    const duration = (job.finishedAt || Date.now()) - (job.startedAt || job.createdAt);

    return (
        <div className="py-3">
            <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
                    <div className="truncate text-sm font-medium">{jobWorkspaceLabel(job)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
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
                <span className="truncate text-xs text-stone-400">{job.size || job.quality || "默认设置"}</span>
                <div className="flex shrink-0 items-center gap-1">
                    {job.status === "succeeded" ? <Button size="small" type="text" aria-expanded={expanded} onClick={onOpen}>{expanded ? "收起结果" : "查看结果"}</Button> : null}
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
            {expanded && job.status === "succeeded" ? <div className="mt-3 space-y-3" aria-label="已生成的图片">
                {job.result?.recoveryPending ? <p role="status" className="text-xs text-muted-foreground">图片已生成，正在保存。可先预览，请勿重复生成。</p> : null}
                {job.result?.images.length ? <Image.PreviewGroup>
                    {job.result.images.map((image, index) => <div key={image.id} className="space-y-1">
                        <Image src={image.persisted === false ? image.recoveryUrl || image.dataUrl : image.dataUrl} alt={`生成结果 ${index + 1}`} width="100%" style={{ maxHeight: 280, objectFit: "contain" }} loading="lazy" />
                        <a className="inline-flex min-h-10 items-center text-sm text-primary hover:underline" href={image.persisted === false ? image.recoveryUrl || image.dataUrl : image.dataUrl} target="_blank" rel="noopener noreferrer" download={image.persisted === false ? undefined : `生成结果-${index + 1}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png"}`}>
                            {image.persisted === false ? "查看原图" : "下载图片"}
                        </a>
                    </div>)}
                </Image.PreviewGroup> : <p className="text-xs text-muted-foreground">暂未读取到图片，请刷新任务后再查看。</p>}
            </div> : null}
            {job.error ? (
                <div className="mt-2 text-xs leading-5 text-stone-500">
                    <p role="status">{generationFailureFeedback(job.error).description}</p>
                    <details>
                        <summary className="min-h-11 cursor-pointer py-3">查看详情</summary>
                        <p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{friendlyErrorMessage(job.error)}</p>
                    </details>
                </div>
            ) : null}
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
    if (job.source?.route === "/product-lab" || job.source?.route === "/product-lab-batch") return "已下线的商品任务";
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

export function VideoTaskItem({ job, onOpen, onStop, onResume, onDismiss }: { job: VideoGenerationLog; onOpen: () => void; onStop: () => void; onResume: () => void; onDismiss: () => void }) {
    const phase = videoTaskPhase(job);
    const active = isActiveVideoTask(job);
    const resumable = phase === "paused" || phase === "canceled";
    const description = phase === "unknown"
        ? "暂时没能确认生成结果，重新生成可能再次计费，请先确认原任务结果。"
        : (phase === "paused" && job.task) || (job.trackingStopped && phase === "submitting")
            ? "视频仍可能继续生成并计费，请稍后查看原任务进度。"
            : phase === "paused"
                ? "视频进度暂未更新，请继续查看原任务。"
                : generationFailureFeedback(job.error || "").description;
    return (
        <div className="py-3">
            <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
                    <div className="truncate text-sm font-medium">流光阁 · 视频</div>
                    <div className="mt-1 truncate text-xs text-stone-500">{job.prompt || job.title}</div>
                    <div className="mt-1 truncate text-xs text-stone-400">
                        {job.model} · {job.seconds}s · {job.resolution}p
                    </div>
                </button>
                <Tag className="m-0 shrink-0" color={active ? "processing" : phase === "succeeded" ? "success" : "default"}>
                    {videoTaskLabel(job)}
                </Tag>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-1">
                {active && !job.trackingStopped ? (
                    <Tooltip title="停止查看进度后，视频仍可能继续生成并计费">
                        <Button size="small" type="text" onClick={onStop}>
                            {job.task || phase === "submitting" ? "停止查看" : "移出队列"}
                        </Button>
                    </Tooltip>
                ) : null}
                {resumable ? (
                    <Button size="small" type="text" onClick={onResume}>
                        {job.task ? "继续查看" : "继续排队"}
                    </Button>
                ) : null}
                <Button size="small" type="text" onClick={onOpen}>
                    查看任务
                </Button>
                {!active && phase !== "succeeded" ? <Button aria-label="暂时隐藏视频任务" type="text" size="small" icon={<X className="size-3.5" />} onClick={onDismiss} /> : null}
            </div>
            {job.error ? (
                <div className="mt-2 text-xs leading-5 text-stone-500">
                    <p role="status">{description}</p>
                    <details>
                        <summary className="min-h-11 cursor-pointer py-3">查看详情</summary>
                        <p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{friendlyErrorMessage(job.error)}</p>
                    </details>
                </div>
            ) : null}
        </div>
    );
}

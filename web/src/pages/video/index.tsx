import { Archive, ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, Eye, FolderPlus, LoaderCircle, Music2, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Tooltip, Typography } from "antd";
import { nanoid } from "nanoid";
import { videoTaskOwner, videoTasks, useVideoTaskStore } from "@/stores/use-video-task-store";
import { isActiveVideoTask, videoAssetFromLog, videoDownloadName, videoTaskLabel, videoTaskPhase, type GeneratedVideo, type VideoGenerationLog as GenerationLog } from "@/services/video-task-model";
import { VIDEO_TASK_QUEUE_LIMIT } from "@/services/video-task-runtime";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { AssetSyncStatus } from "@/components/assets/asset-sync-status";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { videoImageLabel } from "@/lib/video-reference-mode";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { useCultivationProfile } from "@/features/cultivation/queries";
import { cultivationGenerationBlockReason, quotaText, requiredCultivationCapabilities } from "@/features/cultivation/utils";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUserStore } from "@/stores/use-user-store";
import { lazyRoute } from "@/lib/lazy-route";

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const PromptSelectDialog = lazyRoute(() => import("@/components/prompts/prompt-select-dialog").then(({ PromptSelectDialog: Component }) => ({ default: Component })));
const AssetPickerModal = lazyRoute(() => import("@/components/canvas/asset-picker-modal").then(({ AssetPickerModal: Component }) => ({ default: Component })));

export default function VideoPage() {
    const { message } = App.useApp();
    const { data: cultivationProfile } = useCultivationProfile();
    const authenticatedUserId = useUserStore((state) => state.user?.id || "");
    const historyUserId = PUBLIC_MODE ? authenticatedUserId : "local";
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const resultPanelRef = useRef<HTMLDivElement>(null);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const taskLogs = useVideoTaskStore((state) => state.logs);
    const taskOwnerId = useVideoTaskStore((state) => state.ownerId);
    const logsLoading = useVideoTaskStore((state) => state.loading);
    const taskError = useVideoTaskStore((state) => state.error);
    const selectedTaskId = useVideoTaskStore((state) => state.selectedId);
    const logs = taskOwnerId === historyUserId ? taskLogs : [];
    const activeCount = logs.filter(isActiveVideoTask).length;
    const [resultView, setResultView] = useState<"results" | "history">("results");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [savedAssetIds, setSavedAssetIds] = useState<Record<string, string>>({});
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deletingLogs, setDeletingLogs] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const requiredCapabilities = requiredCultivationCapabilities({ model, quality: effectiveConfig.quality, referenceCount: references.length, hasMask: false });
    const generationBlockReason = cultivationProfile
        ? cultivationGenerationBlockReason({
              remainingToday: cultivationProfile.remainingToday,
              unlimited: cultivationProfile.unlimited,
              maxConcurrency: cultivationProfile.maxConcurrency,
              capabilities: cultivationProfile.capabilities,
              requestedCount: 1,
              requiredCapabilities,
          })
        : null;
    const canGenerate = Boolean(prompt.trim()) && !generationBlockReason && !logsLoading && taskOwnerId === historyUserId;
    const selectedPreviewLog = previewLog ? logs.find((log) => log.id === previewLog.id) || null : null;
    const displayLogs = selectedPreviewLog ? [selectedPreviewLog] : logs.slice(0, 20);

    useEffect(() => {
        void videoTasks.prepare(videoTaskOwner());
        setPreviewLog(null);
        setSelectedLogIds([]);
        setSavedAssetIds({});
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
    }, [historyUserId]);

    useEffect(() => {
        videoTasks.setConcurrency(cultivationProfile?.maxConcurrency || 2);
    }, [cultivationProfile?.maxConcurrency]);

    useEffect(() => {
        if (selectedTaskId) {
            setPreviewLog(videoTasks.store.getState().logs.find((log) => log.id === selectedTaskId) || null);
            setResultView("results");
        }
    }, [selectedTaskId]);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考资产，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 16MB 的参考图");
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning("已忽略超过 32MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 16MB 的参考音频");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
            message.warning,
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };
    const generate = () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "视频生成参数无效" });
            return;
        }
        try {
            if (generationBlockReason) throw new Error(generationBlockReason);
            videoTasks.enqueue(snapshot, agentTaskId);
            setResultView("results");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "加入队列失败";
            message.error(detail);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: detail });
        }
    };

    // 响应 Agent 面板下发的视频命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入视频提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        const videoReferenceError = isSeedanceVideoConfig({ ...effectiveConfig, model }) ? seedanceVideoReferenceError(videoReferences) : "";
        if (videoReferenceError) {
            message.error(`${videoReferenceError}。${seedanceVideoReferenceHint}`);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = (log: GenerationLog) => {
        try {
            videoTasks.retry(log.id);
            setResultView("results");
            message.info("已按原任务的提示词、参数和参考素材加入队列");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重试失败");
        }
    };

    const downloadVideo = async (log: GenerationLog) => {
        if (!log.video || log.ownerUserId !== videoTaskOwner()) return;
        try {
            const { saveAs } = await import("file-saver");
            if (log.ownerUserId !== videoTaskOwner()) return;
            saveAs(log.video.url, videoDownloadName(log));
        } catch {
            message.error("下载组件加载失败，请刷新后重试");
        }
    };

    const saveResultToAssets = (log: GenerationLog) => {
        if (log.ownerUserId !== videoTaskOwner()) return;
        const assetId = addAsset(videoAssetFromLog(log));
        setSavedAssetIds((ids) => ({ ...ids, [log.id]: assetId }));
        message.info(PUBLIC_MODE ? "已加入资产列表，请留意云端同步状态" : "已加入本机资产列表");
    };

    const resumeTask = (log: GenerationLog) => {
        try {
            videoTasks.resume(log.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "恢复查询失败");
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height }].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setSelectedLogIds([]);
        setPreviewLog(null);
        videoTasks.select(null);
        setResultView("results");
    };

    const deleteSelectedLogs = async () => {
        if (!selectedLogIds.length || deletingLogs) return;
        setDeletingLogs(true);
        try {
            await videoTasks.remove(selectedLogIds);
            if (previewLog && selectedLogIds.includes(previewLog.id)) setPreviewLog(null);
            setSelectedLogIds([]);
            setDeleteConfirmOpen(false);
            message.success("已移除选中的视频记录");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "记录删除失败");
        } finally {
            setDeletingLogs(false);
        }
    };

    const openHistory = () => {
        setResultView("history");
        void videoTasks.refresh();
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setResultView("results");
    };

    const continueFromGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setResultView("results");
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        updateConfig("videoMode", log.config.videoMode || "");
        message.success("已恢复提示词与生成参数");
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto p-3 lg:overflow-hidden">
                <section className="grid min-w-0 gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex min-w-0 flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        {/* 流光阁 · 场景横幅(仅 UI,逻辑不变) */}
                        <div className="relative mb-6 overflow-hidden rounded-lg">
                            <img src="/images/ref/nebula-vortex.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e12]/88 via-[#0e0e12]/62 to-[#0e0e12]/28" aria-hidden />
                            <div className="relative flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
                                <div className="min-w-0">
                                    <p className="text-[10px] tracking-[0.4em] text-[#c9a86a]">LIU GUANG GE</p>
                                    <h1 className="font-brush mt-2 text-4xl text-[#edede6] [text-shadow:0_2px_20px_rgb(0_0_0/0.6)]">流光阁</h1>
                                    <p className="font-display mt-1.5 text-xs tracking-[0.1em] text-[#edede6]/70">流光一瞬,亦可成境 · 视频由此而生</p>
                                </div>
                                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto lg:hidden">
                                    <Button
                                        className="min-w-0"
                                        icon={<Archive className="size-4" />}
                                        onClick={() => {
                                            openHistory();
                                            window.setTimeout(() => resultPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                                        }}
                                    >
                                        太古遗迹
                                    </Button>
                                    <Button className="min-w-0" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        参数
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="text-base font-semibold">提示词</span>
                                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                                        <Button className="min-w-0" size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            查看提示词库
                                        </Button>
                                        <Button className="min-w-0" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            查看我的资产
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea
                                    value={prompt}
                                    onChange={(event) => setPrompt(event.target.value)}
                                    onKeyDown={(event) => {
                                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canGenerate) {
                                            event.preventDefault();
                                            void generate();
                                        }
                                    }}
                                    rows={7}
                                    placeholder="描述镜头运动、主体动作、场景氛围和画面风格（Ctrl+Enter 快速生成）"
                                />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-base font-semibold">参考图</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.dataTransfer.files.length) void addReferences(e.dataTransfer.files);
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                {effectiveConfig.videoMode ? videoImageLabel(effectiveConfig.videoMode, references.length, index, videoReferences.length + audioReferences.length) : seedanceReferenceLabel("image", index)}
                                            </span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-black/60 text-white transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图，最多 9 张</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-base font-semibold">参考视频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => videoInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.dataTransfer.files.length) void addReferences(e.dataTransfer.files);
                                    }}
                                >
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-black/60 text-white transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                                                onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考视频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考视频，最多 3 个</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-base font-semibold">参考音频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => audioInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.dataTransfer.files.length) void addReferences(e.dataTransfer.files);
                                    }}
                                >
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                            <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-black/60 text-white transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                                                onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考音频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">暂无参考音频，最多 3 个，mp3/wav，单个 16MB 内</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {normalizeResolution(effectiveConfig.vquality)}p · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    调整
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={() => void generate()}>
                                {activeCount ? "加入生成队列" : "开始生成"}
                            </Button>
                            <p className="mt-2 text-center text-xs text-stone-400">最多同时跟踪 2 个任务 · 待处理上限 {VIDEO_TASK_QUEUE_LIMIT} 个 · 离开本页仍会继续查询</p>
                            {generationBlockReason ? (
                                <div className="mt-2 text-center text-xs text-amber-600 dark:text-amber-400">{generationBlockReason}</div>
                            ) : cultivationProfile ? (
                                <div className="mt-2 text-center text-xs text-stone-400">{quotaText(cultivationProfile.remainingToday, cultivationProfile.unlimited)}</div>
                            ) : null}
                        </div>
                    </div>

                    <div ref={resultPanelRef} className="thin-scrollbar min-w-0 rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                                <h2 className="text-xl font-semibold">{resultView === "results" ? "生成结果" : "太古遗迹"}</h2>
                                {resultView === "results" && selectedPreviewLog ? <Tag className="m-0">任务详情</Tag> : null}
                                {resultView === "history" ? <Tag className="m-0">{logs.length}</Tag> : null}
                                {activeCount ? <Tag className="m-0">{activeCount} 个任务处理中</Tag> : null}
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
                                {resultView === "results" && selectedPreviewLog ? (
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowLeft className="size-3.5" />}
                                        onClick={() => {
                                            setPreviewLog(null);
                                            videoTasks.select(null);
                                        }}
                                    >
                                        查看全部任务
                                    </Button>
                                ) : null}
                                {resultView === "history" ? (
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowLeft className="size-3.5" />}
                                        onClick={() => {
                                            setPreviewLog(null);
                                            setResultView("results");
                                        }}
                                    >
                                        返回生成结果
                                    </Button>
                                ) : (
                                    <Button size="small" icon={<Archive className="size-3.5" />} onClick={openHistory}>
                                        太古遗迹
                                    </Button>
                                )}
                                <Tooltip title="开始新作">
                                    <Button aria-label="开始新作" size="small" type="text" icon={<Plus className="size-4" />} onClick={createSession} />
                                </Tooltip>
                            </div>
                        </div>
                        {taskError ? (
                            <p role="alert" className="mb-3 text-sm text-amber-600 dark:text-amber-400">
                                {taskError}{" "}
                                <Button size="small" type="text" onClick={() => void videoTasks.refresh()}>
                                    重新同步
                                </Button>
                            </p>
                        ) : null}
                        {resultView === "history" && logsLoading && !logs.length ? (
                            <HistoryLoading />
                        ) : resultView === "history" ? (
                            <LogPanel
                                logs={logs}
                                selectedLogIds={selectedLogIds}
                                activeLogId={previewLog?.id}
                                onSelectedLogIdsChange={setSelectedLogIds}
                                onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                onPreviewLog={previewGenerationLog}
                                onContinueLog={continueFromGenerationLog}
                            />
                        ) : displayLogs.length ? (
                            <div className="grid gap-4">
                                {displayLogs.map((log) => (
                                    <section key={log.id} aria-label={log.title || "视频任务"}>
                                        <div className="mb-2 flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="line-clamp-2 text-sm">{log.prompt}</p>
                                                <p className="mt-1 text-xs text-stone-400">
                                                    {log.model} · {log.resolution}p · {log.seconds}s
                                                </p>
                                            </div>
                                            <Tag className="m-0 shrink-0">{videoTaskLabel(log)}</Tag>
                                        </div>
                                        {log.video ? (
                                            <ResultVideoCard video={log.video} onDownload={() => void downloadVideo(log)} onSaveAsset={() => saveResultToAssets(log)} />
                                        ) : ["failed", "unknown"].includes(videoTaskPhase(log)) ? (
                                            <FailedVideoCard error={log.error || "生成失败"} uncertain={videoTaskPhase(log) === "unknown"} onRetry={() => retryResult(log)} />
                                        ) : (
                                            <PendingVideoCard log={log} onResume={() => resumeTask(log)} onStop={() => videoTasks.stop(log.id)} />
                                        )}
                                        {savedAssetIds[log.id] ? <AssetSyncStatus assetId={savedAssetIds[log.id]} className="mt-2" /> : null}
                                    </section>
                                ))}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成视频" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime"
                multiple
                className="hidden"
                onChange={(e) => {
                    void addReferences(e.target.files);
                    e.target.value = "";
                }}
            />
            <input
                ref={audioInputRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(e) => {
                    void addReferences(e.target.files);
                    e.target.value = "";
                }}
            />
            <Drawer title="参数" placement="bottom" height="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            {promptDialogOpen ? (
                <Suspense fallback={<DeferredVideoToolLoading label="正在打开提示词库..." />}>
                    <PromptSelectDialog open onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
                </Suspense>
            ) : null}
            {assetPickerOpen ? (
                <Suspense fallback={<DeferredVideoToolLoading label="正在打开资产..." />}>
                    <AssetPickerModal open defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
                </Suspense>
            ) : null}
            <Modal
                title="移除太古遗迹记录"
                open={deleteConfirmOpen}
                onCancel={() => setDeleteConfirmOpen(false)}
                onOk={() => void deleteSelectedLogs()}
                okText="删除"
                confirmLoading={deletingLogs}
                okButtonProps={{ danger: true }}
                cancelButtonProps={{ disabled: deletingLogs }}
                closable={!deletingLogs}
                mask={{ closable: !deletingLogs }}
                cancelText="取消"
            >
                <div className="space-y-2">
                    <p>确定从太古遗迹移除选中的 {selectedLogIds.length} 条记录吗？</p>
                    <p className="text-sm text-stone-500 dark:text-stone-400">进行中的任务请先停止查询或移出队列。停止查询和删除记录不会取消上游生成，仍可能计费。</p>
                    <p className="text-sm text-stone-500 dark:text-stone-400">已入藏卷阁的作品不会受到影响。</p>
                </div>
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} selectedModel={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        添加到资产
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ log, onResume, onStop }: { log: GenerationLog; onResume: () => void; onStop: () => void }) {
    const active = isActiveVideoTask(log);
    const resumable = ["paused", "canceled"].includes(videoTaskPhase(log));
    return (
        <div className="relative min-h-48 overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 py-5 text-sm text-stone-500 dark:text-stone-400">
                {active && !log.trackingStopped ? <LoaderCircle className="size-6 animate-spin" /> : null}
                <span className="max-w-lg text-center">{log.error || videoTaskLabel(log)}</span>
                {resumable ? <Button onClick={onResume}>{log.task ? "继续查询原任务" : "继续排队"}</Button> : null}
                {active && !log.trackingStopped ? <Button onClick={onStop}>{log.task || log.phase === "submitting" ? "停止查询" : "移出队列"}</Button> : null}
                {active || log.task ? <span className="max-w-lg text-center text-xs">停止查询不会取消上游生成，上游仍可能继续生成和计费。</span> : null}
            </div>
        </div>
    );
}

function FailedVideoCard({ error, uncertain, onRetry }: { error: string; uncertain?: boolean; onRetry: () => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{uncertain ? "创建结果未确认" : "生成失败"}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {uncertain ? "按原参数重新生成（可能再次计费）" : "按原参数重新生成"}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onDeleteSelected,
    onPreviewLog,
    onContinueLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
    onContinueLog: (log: GenerationLog) => void;
}) {
    const [managing, setManaging] = useState(false);
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));
    const finishManaging = () => {
        setManaging(false);
        onSelectedLogIdsChange([]);
    };

    return (
        <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">视频生成记录会自动保留，满意的作品仍需手动入藏卷阁。</p>
                <div className="flex shrink-0 items-center gap-1">
                    {managing ? (
                        <>
                            <Button size="small" type="text" disabled={!logs.length} onClick={toggleAll}>
                                {allSelected ? "取消全选" : "全选"}
                            </Button>
                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                                移除
                            </Button>
                            <Button size="small" onClick={finishManaging}>
                                完成
                            </Button>
                        </>
                    ) : (
                        <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={() => setManaging(true)}>
                            管理
                        </Button>
                    )}
                </div>
            </div>
            <div className="grid gap-3 2xl:grid-cols-2">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        managing={managing}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onPreview={() => onPreviewLog(log)}
                        onContinue={() => onContinueLog(log)}
                    />
                ))}
                {!logs.length ? (
                    <div className="col-span-full flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700">
                        <VideoIcon className="mb-3 size-8 text-stone-400" />
                        <div className="text-sm font-medium">遗迹尚未留下流光</div>
                        <div className="mt-1 text-xs text-stone-500">完成第一次视频生成后，记录会自动出现在这里。</div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function LogCard({
    log,
    selected,
    active,
    managing,
    onSelectedChange,
    onPreview,
    onContinue,
}: {
    log: GenerationLog;
    selected: boolean;
    active: boolean;
    managing: boolean;
    onSelectedChange: (checked: boolean) => void;
    onPreview: () => void;
    onContinue: () => void;
}) {
    const title = log.prompt.replace(/\s+/g, " ").trim() || log.title || "未命名流光";

    return (
        <article
            className={`relative overflow-hidden rounded-lg border bg-background transition ${active ? "border-stone-900 ring-1 ring-stone-900/10 dark:border-stone-100 dark:ring-stone-100/10" : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"}`}
        >
            {managing ? (
                <div className="absolute left-2 top-2 z-10 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur-sm">
                    <Checkbox checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} />
                </div>
            ) : null}
            <button type="button" className="block w-full text-left" onClick={() => (managing ? onSelectedChange(!selected) : onPreview())}>
                <div className="relative aspect-video overflow-hidden bg-stone-950">
                    {log.video?.url ? (
                        <video src={log.video.url} muted preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                    ) : (
                        <VideoIcon className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-stone-500" />
                    )}
                    <Tag className="absolute right-2 top-2 m-0" color={log.video ? "success" : isActiveVideoTask(log) ? "processing" : videoTaskPhase(log) === "failed" ? "error" : "default"}>
                        {videoTaskLabel(log)}
                    </Tag>
                </div>
                <div className="p-3">
                    <div className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{title}</div>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs text-stone-500">
                        <span className="truncate">{log.model || "默认模型"}</span>
                        <span className="shrink-0">
                            {log.resolution}p · {log.seconds}s · {formatDuration(log.durationMs)}
                        </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-stone-400">{log.time}</div>
                </div>
            </button>
            {!managing ? (
                <div className="flex items-center justify-end gap-1 border-t border-stone-200 px-2 py-1.5 dark:border-stone-800">
                    <Button size="small" type="text" icon={<Eye className="size-3.5" />} onClick={onPreview}>
                        查看结果
                    </Button>
                    <Button size="small" type="text" icon={<PenLine className="size-3.5" />} onClick={onContinue}>
                        继续创作
                    </Button>
                </div>
            ) : null}
        </article>
    );
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function DeferredVideoToolLoading({ label }: { label: string }) {
    return (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/10 backdrop-blur-[1px]" aria-live="polite">
            <span className="rounded border border-stone-200 bg-background px-4 py-2 text-sm text-stone-600 shadow-xl dark:border-stone-700 dark:text-stone-300">{label}</span>
        </div>
    );
}

function HistoryLoading() {
    return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-sm text-stone-500 dark:text-stone-400 lg:min-h-[560px]" aria-live="polite">
            <LoaderCircle className="size-5 animate-spin" />
            <span>正在同步太古遗迹...</span>
        </div>
    );
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return {
        ...config,
        model,
        videoModel: model,
        size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

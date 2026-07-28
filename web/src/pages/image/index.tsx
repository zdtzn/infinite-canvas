import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ChevronDown, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";

import { ImageSettingsPanel, imageGenerationQualityLabel, imageOutputFormatLabel, imageResolutionLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { DeferredImage } from "@/components/ui/deferred-image";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { resolveModelChannel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { convertImageOutput, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { clearImageGenerationJob, getImageGenerationSnapshot, replaceImageGenerationResult, retryImageGeneration, startImageGeneration, subscribeImageGeneration, type GeneratedImage, type GenerationResult } from "@/services/image-generation-runtime";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import { deriveImageModelCapabilities } from "@/stores/model-capabilities";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { useImperialGenerationCue, useImperialMode } from "@/features/cultivation/imperial-mode";
import { cultivationGenerationBlockReason, cultivationRefundNotice, quotaText, requiredCultivationCapabilities } from "@/features/cultivation/utils";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { deleteGenerationHistoryRecords, persistGenerationHistoryRecord, persistGenerationHistoryRecords, synchronizeGenerationHistory } from "@/services/generation-history";
import { mergeServerJobsIntoImageHistory } from "@/services/image-generation-history";
import { fetchServerJobs, removeServerJob, type ServerJob } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

type GenerationLog = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    ownerUserId?: string;
    serverJobIds?: string[];
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "成功" | "失败";
    images: GeneratedImage[];
    thumbnails: string[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "imageQuality" | "imageOutputFormat" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data: cultivationProfile } = useCultivationProfile();
    const { generationSuccessMessage, isImperialMode } = useImperialMode();
    const imperialGenerationCue = useImperialGenerationCue();
    const authenticatedUserId = useUserStore((state) => state.user?.id || "");
    const historyUserId = PUBLIC_MODE ? authenticatedUserId : "local";
    const fileInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [savingAssetIds, setSavingAssetIds] = useState<string[]>([]);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const savingAssetIdsRef = useRef(new Set<string>());
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const generationJob = useSyncExternalStore(subscribeImageGeneration, getImageGenerationSnapshot, getImageGenerationSnapshot);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const activeChannel = resolveModelChannel(effectiveConfig, model);
    const activeImageCapabilities = deriveImageModelCapabilities(model, activeChannel.apiFormat, activeChannel.baseUrl);
    const appliedImageQuality = activeImageCapabilities.generationQualities.includes(effectiveConfig.imageQuality) ? effectiveConfig.imageQuality : "auto";
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const requiredCapabilities = requiredCultivationCapabilities({ model, quality: effectiveConfig.quality, referenceCount: references.length, hasMask: false });
    const generationBlockReason = cultivationProfile
        ? cultivationGenerationBlockReason({
              remainingToday: cultivationProfile.remainingToday,
              unlimited: cultivationProfile.unlimited,
              maxConcurrency: cultivationProfile.maxConcurrency,
              capabilities: cultivationProfile.capabilities,
              requestedCount: generationCount,
              requiredCapabilities,
          })
        : null;
    const canGenerate = Boolean(prompt.trim()) && !generationBlockReason;
    const running = generationJob?.status === "running";
    const generateButtonLabel = isImperialMode && (running || imperialGenerationCue.active) ? "天地法则演化中……" : running ? "生成中……" : "开始生成";
    const elapsedMs = generationJob?.elapsedMs || 0;
    const results: GenerationResult[] = previewLog ? previewLog.images.map((image) => ({ id: image.id, status: "success", image })) : generationJob?.results || [];

    useEffect(() => {
        void refreshLogs();
    }, [historyUserId]);

    useEffect(() => {
        if (!generationJob) return;
        setPrompt((value) => value || generationJob.prompt);
        setReferences((value) => (value.length ? value : generationJob.references));
    }, [generationJob?.id]);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const maxReferences = activeImageCapabilities.maxReferences;
        if (references.length + imageFiles.length > maxReferences) {
            message.error(`当前模型最多支持 ${maxReferences} 张参考图`);
            return;
        }
        try {
            const nextReferences = await Promise.all(
                imageFiles.map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图上传失败");
        }
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
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const generate = () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "请输入生图提示词" });
            return;
        }
        if (generationBlockReason) {
            message.warning(generationBlockReason);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: generationBlockReason });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图配置不完整" });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图参数无效" });
            return;
        }

        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const jobId = startImageGeneration(
            snapshot,
            generationCount,
            async ({ successImages, successCount, failCount, error, durationMs }) => {
                void queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey });
                if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });
                const logImages = await Promise.all(
                    successImages.map(async (image) => {
                        const stored = await uploadImage(image.dataUrl, { outputFormat: snapshot.config.imageOutputFormat });
                        return { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                    }),
                );
                logImages.forEach(replaceImageGenerationResult);
                saveLog(
                    buildLog({
                        prompt: text,
                        model,
                        config: { ...snapshot.config, count: String(generationCount) },
                        references: snapshot.references,
                        durationMs,
                        successCount,
                        failCount,
                        status: successCount ? "成功" : "失败",
                        images: logImages,
                    }),
                );
                if (successCount) {
                    const settlement = failCount
                        ? `成功 ${successCount} 张，失败 ${failCount} 张${cultivationRefundNotice(cultivationProfile?.unlimited, "failed")}`
                        : `成功生成 ${successCount} 张图片`;
                    message.success(generationSuccessMessage(settlement));
                } else {
                    message.error(`${error || "生成失败"}${cultivationRefundNotice(cultivationProfile?.unlimited, "all")}`);
                }
            },
            undefined,
            cultivationProfile?.maxConcurrency || generationCount,
        );
        if (!jobId && agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图工作台已有任务正在运行" });
    };

    // 响应 Agent 面板下发的生图命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: "生图工作台已有任务正在运行" });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = async (image: GeneratedImage, index: number) => {
        try {
            const outputFormat = previewLog?.config.imageOutputFormat || generationJob?.snapshot?.config.imageOutputFormat || effectiveConfig.imageOutputFormat;
            const blob = await convertImageOutput(image.dataUrl, outputFormat);
            saveAs(blob, `image-${index + 1}.${imageFileExtension(blob.type)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载图片失败");
        }
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const outputFormat = previewLog?.config.imageOutputFormat || generationJob?.snapshot?.config.imageOutputFormat || effectiveConfig.imageOutputFormat;
        const stored = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/*" } : await uploadImage(image.dataUrl, { outputFormat });
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.${imageFileExtension(stored.mimeType)}`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success("已加入参考图");
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        if (savingAssetIdsRef.current.has(image.id)) return;
        savingAssetIdsRef.current.add(image.id);
        setSavingAssetIds((ids) => [...ids, image.id]);
        try {
            // Generated results are already persisted by the job flow. Reusing that asset avoids a
            // duplicate upload and prevents upstream MIME headers from affecting asset registration.
            const stored = image.storageKey
                ? { url: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/*" }
                : await uploadImage(image.dataUrl, { outputFormat: previewLog?.config.imageOutputFormat || generationJob?.snapshot?.config.imageOutputFormat || effectiveConfig.imageOutputFormat });
            addAsset({
                kind: "image",
                title: `生成结果 ${index + 1}`,
                coverUrl: stored.url,
                tags: [],
                source: "生图工作台",
                data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "image-page", prompt },
            });
            message.success("已加入我的资产");
        } catch (error) {
            console.error("Failed to save generated image as an asset", error);
            message.error(error instanceof Error ? `添加到资产失败：${error.message}` : "添加到资产失败，请重试");
        } finally {
            savingAssetIdsRef.current.delete(image.id);
            setSavingAssetIds((ids) => ids.filter((id) => id !== image.id));
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning("生图工作台只能使用文本或图片资产");
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        if (!clearImageGenerationJob()) {
            message.warning("当前任务仍在生成，请等待完成后再新建");
            return;
        }
        setPrompt("");
        setReferences([]);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const selected = logs.filter((log) => selectedLogIds.includes(log.id));
        const serverJobIds = Array.from(new Set(selected.flatMap((log) => log.serverJobIds || [])));
        void Promise.allSettled([deleteGenerationHistoryRecords({ kind: "image", userId: historyUserId, store: logStore }, selectedLogIds), ...serverJobIds.map((id) => removeServerJob(id, historyUserId))]).then(refreshLogs);
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = (log: GenerationLog) => {
        void persistGenerationHistoryRecord({ kind: "image", userId: historyUserId, store: logStore, hydrate: normalizeLog, prepare: prepareImageLogForServer }, { ...serializeLog(log), updatedAt: Date.now() }).then(refreshLogs);
    };

    const refreshLogs = async () => {
        const options = { kind: "image" as const, userId: historyUserId, store: logStore, hydrate: normalizeLog, prepare: prepareImageLogForServer };
        let nextLogs = await synchronizeGenerationHistory(options);
        if (PUBLIC_MODE && historyUserId) {
            try {
                const jobs = (await fetchServerJobs(historyUserId)).items;
                const merged = mergeServerJobsIntoImageHistory(nextLogs, jobs, buildLogFromServerJob);
                if (imageHistoryChanged(nextLogs, merged)) nextLogs = await persistGenerationHistoryRecords(options, merged);
                else nextLogs = merged;
            } catch {
                // The account history remains usable even if task recovery is temporarily unavailable.
            }
        }
        setLogs(nextLogs);
        return nextLogs;
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        updateConfig("imageQuality", log.config.imageQuality || "auto");
        updateConfig("imageOutputFormat", log.config.imageOutputFormat || "auto");
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        if (generationBlockReason) {
            message.warning(generationBlockReason);
            return;
        }
        setPreviewLog(null);
        const retryStartedAt = Date.now();
        try {
            const image = await retryImageGeneration(index, snapshot);
            if (!image) return;
            const stored = await uploadImage(image.dataUrl, { outputFormat: snapshot.config.imageOutputFormat });
            const logImage = { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
            replaceImageGenerationResult(logImage);
            saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: snapshot.references,
                    durationMs: Date.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "成功",
                    images: [logImage],
                }),
            );
            message.success("重试成功");
        } finally {
            void queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey });
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto p-3 lg:overflow-hidden">
                <section className="grid min-h-0 min-w-0 w-full gap-3 lg:h-full lg:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
                    <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:h-full">
                        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
                            {/* 丹青台 · 场景横幅(仅 UI,逻辑不变) */}
                            <div className="relative mb-6 overflow-hidden rounded-lg">
                                <img src="/images/ref/energy-vortex-2.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e12]/88 via-[#0e0e12]/62 to-[#0e0e12]/28" aria-hidden />
                                <div className="relative flex items-end justify-between gap-3 p-5">
                                    <div className="min-w-0">
                                        <p className="text-[10px] tracking-[0.4em] text-[#c9a86a]">DAN QING TAI</p>
                                        <h1 className="font-brush mt-2 text-4xl text-[#edede6] [text-shadow:0_2px_20px_rgb(0_0_0/0.6)]">丹青台</h1>
                                        <p className="font-display mt-1.5 text-xs tracking-[0.1em] text-[#edede6]/70">一笔落墨,万象皆成 · 结果在这里持续保留</p>
                                    </div>
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        历史
                                    </Button>
                                </div>
                            </div>

                            <div className="mt-6 space-y-5">
                                <div>
                                    <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <span className="text-base font-semibold">提示词</span>
                                        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                                            <Button className="min-w-0" size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                                提示词库
                                            </Button>
                                            <Button className="min-w-0" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                                我的资产
                                            </Button>
                                        </div>
                                    </div>
                                    <Input.TextArea
                                        value={prompt}
                                        onChange={(event) => setPrompt(event.target.value)}
                                        onKeyDown={(event) => {
                                            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canGenerate && !running) {
                                                event.preventDefault();
                                                void generate();
                                            }
                                        }}
                                        rows={6}
                                        placeholder="描述画面主体、风格、构图、光线和用途（Ctrl+Enter 快速生成）"
                                    />
                                </div>

                                <div className="min-w-0">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <span className="text-base font-semibold">参考图</span>
                                            <span className="ml-2 text-xs text-stone-400">可上传或从剪贴板粘贴</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                                粘贴
                                            </Button>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                上传
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        className="hover-scrollbar hover-scrollbar-hint flex min-h-20 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
                                        onWheel={(event) => {
                                            if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                            event.preventDefault();
                                            event.currentTarget.scrollLeft += event.deltaY;
                                        }}
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
                                            <div key={item.id} className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800 sm:size-20">
                                                <img src={item.dataUrl} alt={item.name} className="size-full object-cover" decoding="async" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
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
                                        {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图</div> : null}
                                    </div>
                                </div>

                                <div>
                                    <label className="block min-w-0">
                                        <span className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">模型</span>
                                        <ModelPicker config={effectiveConfig} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
                                    </label>
                                </div>

                                <div className="rounded-lg border border-stone-200 dark:border-stone-800">
                                    <details className="group">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:content-none">
                                            <span className="inline-flex shrink-0 items-center gap-2">
                                                <SlidersHorizontal className="size-4 text-stone-500" />
                                                高级参数
                                            </span>
                                            <span className="flex min-w-0 items-center gap-1.5 text-stone-500 dark:text-stone-400">
                                                <span className="truncate text-xs font-normal">
                                                    {effectiveConfig.size} · {imageResolutionLabel(effectiveConfig.quality)} · {imageGenerationQualityLabel(appliedImageQuality)} · {imageOutputFormatLabel(effectiveConfig.imageOutputFormat)}
                                                </span>
                                                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                            </span>
                                        </summary>
                                        <div className="border-t border-stone-200 p-3 dark:border-stone-800">
                                            <GenerationSettings config={effectiveConfig} updateConfig={updateConfig} />
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </div>

                        <div className="shrink-0 border-t border-stone-200 bg-card p-4 dark:border-stone-800">
                            <Button
                                type="primary"
                                size="large"
                                block
                                className="imperial-generate-button"
                                icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                aria-busy={running}
                                aria-live="polite"
                                disabled={!canGenerate || running}
                                onClick={() => {
                                    imperialGenerationCue.trigger();
                                    generate();
                                }}
                            >
                                {generateButtonLabel}
                            </Button>
                            {generationBlockReason ? (
                                <div className="mt-2 text-center text-xs text-amber-600 dark:text-amber-400">{generationBlockReason}</div>
                            ) : cultivationProfile ? (
                                <div className="mt-2 text-center text-xs text-stone-400">
                                    {cultivationProfile.unlimited ? `本次生成 ${generationCount} 张 · 今日不限次数 · 失败不计入用量` : `本次将占用 ${generationCount} 次 · ${quotaText(cultivationProfile.remainingToday, false)} · 失败自动退还`}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <section className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:h-full lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">生成结果</h2>
                            {running ? <Tag className="m-0 px-2 py-1">已等待 {formatDuration(elapsedMs)}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard
                                            key={result.id}
                                            image={result.image}
                                            index={index}
                                            savingAsset={savingAssetIds.includes(result.image.id)}
                                            onEdit={addResultToReferences}
                                            onDownload={downloadImage}
                                            onSaveAsset={saveResultToAssets}
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || "生成失败"} onRetry={() => retryResult(index)} />
                                    ) : (
                                        <PendingImageCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[calc(100%_-_3rem)]">
                                <ImagePlus className="mb-3 size-9 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={running ? "正在准备生成结果" : "暂无生成结果"} />
                            </div>
                        )}
                    </section>
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
            <Drawer title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)} destroyOnHidden>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, updateConfig }: { config: AiConfig; updateConfig: UpdateAiConfig }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />;
}

function ResultImageCard({
    image,
    index,
    savingAsset,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    savingAsset: boolean;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const [previewStatus, setPreviewStatus] = useState<"loading" | "loaded" | "error">("loading");
    const [previewAttempt, setPreviewAttempt] = useState(0);

    useEffect(() => {
        setPreviewStatus("loading");
        setPreviewAttempt(0);
    }, [image.dataUrl]);

    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="relative aspect-square overflow-hidden bg-stone-100 dark:bg-stone-900">
                {previewStatus !== "loaded" ? (
                    <div className="absolute inset-0 z-10 grid place-items-center p-4 text-center" aria-live="polite">
                        {previewStatus === "error" ? (
                            <div className="space-y-2">
                                <div className="text-sm text-stone-500 dark:text-stone-400">高清预览加载失败</div>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setPreviewStatus("loading");
                                        setPreviewAttempt((attempt) => attempt + 1);
                                    }}
                                >
                                    重新加载预览
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                                <LoaderCircle className="size-4 animate-spin" />
                                正在载入高清预览
                            </div>
                        )}
                    </div>
                ) : null}
                <Image
                    key={`${image.id}:${previewAttempt}`}
                    src={retryImageUrl(image.dataUrl, previewAttempt)}
                    alt={`生成结果 ${index + 1}`}
                    rootClassName="block size-full"
                    className={`size-full object-contain transition-opacity duration-200 ${previewStatus === "loaded" ? "opacity-100" : "opacity-0"}`}
                    style={{ width: "100%", height: "100%" }}
                    loading="eager"
                    decoding="async"
                    fetchPriority={index === 0 ? "high" : "auto"}
                    preview={previewStatus === "loaded"}
                    onLoad={() => setPreviewStatus("loaded")}
                    onError={() => setPreviewStatus("error")}
                />
            </div>
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title="添加到资产">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} loading={savingAsset} disabled={savingAsset} onClick={() => void onSaveAsset(image, index)}>
                            添加到资产
                        </Button>
                    </Tooltip>
                    <Tooltip title="加入参考图">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            加入参考图
                        </Button>
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(image, index)}>
                            下载
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function retryImageUrl(url: string, attempt: number) {
    if (!attempt || !url.startsWith("/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}previewRetry=${attempt}`;
}

function PendingImageCard() {
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
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
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">生成记录</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新建
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <DeferredImage key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" fetchPriority="low" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            成功 {log.successCount ?? log.imageCount}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                失败 {log.failCount}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.imageCount} 张</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        updatedAt: log.updatedAt || log.createdAt || Date.now(),
        ownerUserId: log.ownerUserId,
        serverJobIds: Array.from(new Set((log.serverJobIds || []).filter(Boolean))),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "成功",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

async function prepareImageLogForServer(log: GenerationLog, expectedUserId: string): Promise<GenerationLog> {
    const references = await Promise.all(
        log.references.map(async (item) => {
            if (item.storageKey || !item.dataUrl) return item;
            const stored = await uploadImage(item.dataUrl, { expectedUserId });
            return { ...item, dataUrl: stored.url, storageKey: stored.storageKey, type: stored.mimeType };
        }),
    );
    const images = await Promise.all(
        log.images.map(async (image) => {
            if (image.storageKey || !image.dataUrl) return image;
            const stored = await uploadImage(image.dataUrl, { outputFormat: log.config.imageOutputFormat, expectedUserId });
            return {
                ...image,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
        }),
    );
    return serializeLog({ ...log, references, images, thumbnails: [] });
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function buildLogFromServerJob(job: ServerJob): GenerationLog {
    const images: GeneratedImage[] = (job.result?.images || []).map((image) => ({
        id: image.id,
        dataUrl: image.dataUrl,
        durationMs: image.durationMs || job.result?.durationMs || 0,
        width: image.width || 0,
        height: image.height || 0,
        bytes: image.bytes || 0,
        mimeType: image.mimeType,
        serverJobId: job.id,
    }));
    const config: GenerationLogConfig = {
        model: job.model,
        imageModel: job.model,
        quality: job.quality || "",
        imageQuality: job.imageQuality || "auto",
        imageOutputFormat: job.imageOutputFormat || "auto",
        size: job.size || "",
        count: String(job.count || images.length || 1),
    };
    return {
        id: `server-job:${job.id}`,
        createdAt: job.createdAt,
        updatedAt: job.finishedAt || job.createdAt,
        serverJobIds: [job.id],
        title: job.prompt.slice(0, 12) || "未命名",
        prompt: job.prompt,
        time: new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false }),
        model: job.model,
        config,
        references: [],
        durationMs: job.result?.durationMs || Math.max(0, Number(job.finishedAt || job.createdAt) - Number(job.startedAt || job.createdAt)),
        successCount: job.result?.successCount || 0,
        failCount: job.result?.failCount || (job.status === "succeeded" ? 0 : job.count || 1),
        imageCount: images.length,
        size: config.size,
        quality: config.quality,
        status: job.status === "succeeded" ? "成功" : "失败",
        images,
        thumbnails: images.map((image) => image.dataUrl),
    };
}

function imageHistoryChanged(previous: GenerationLog[], next: GenerationLog[]) {
    if (previous.length !== next.length) return true;
    const previousById = new Map(previous.map((log) => [log.id, log]));
    return next.some((log) => {
        const current = previousById.get(log.id);
        if (!current) return true;
        return [...(current.serverJobIds || [])].sort().join("|") !== [...(log.serverJobIds || [])].sort().join("|");
    });
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        imageQuality: log.config?.imageQuality || "auto",
        imageOutputFormat: log.config?.imageOutputFormat || "auto",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
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

function imageFileExtension(mimeType: string) {
    return ({ "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "image/avif": "avif" } as Record<string, string>)[mimeType.toLowerCase()] || "png";
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        imageQuality: config.imageQuality,
        imageOutputFormat: config.imageOutputFormat,
        size: config.size,
        count: config.count,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        serverJobIds: Array.from(new Set(images.map((image) => image.serverJobId).filter((id): id is string => Boolean(id)))),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

import { Archive, ArrowLeft, ArrowRight, BookOpen, CheckSquare, ChevronDown, ClipboardPaste, Eye, FolderPlus, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { App, Button, Checkbox, Input, Modal, Pagination, Select, Tag, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { ImagePromptOptimizer } from "@/components/prompts/image-prompt-optimizer";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { DeferredImage } from "@/components/ui/deferred-image";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imageGenerationQualityLabel, imageOutputFormatLabel, imageResolutionLabel, imageSizeLabel } from "@/lib/image-setting-labels";
import { modelOptionLabel, normalizeImageSizeSelection, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatDuration } from "@/lib/image-utils";
import { settleWithConcurrency } from "@/lib/async-pool";
import { getClipboardImageFiles } from "@/lib/image-clipboard";
import { convertImageOutput, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { clearImageGenerationJob, getImageGenerationSnapshot, replaceImageGenerationResult, retryImageGeneration, startImageGeneration, subscribeImageGeneration, type GeneratedImage, type GenerationResult } from "@/services/image-generation-runtime";
import { IMAGE_WORKBENCH_ASSET_SOURCE } from "@/stores/asset-source";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { resolveImageSlotConcurrency } from "@/stores/model-capabilities";
import { limitImageReferenceAdditions } from "@/lib/image-references";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { useImperialGenerationCue, useImperialMode } from "@/features/cultivation/imperial-mode";
import { GenerationFailureToast, generationFailureFeedback, generationFailureText } from "@/features/cultivation/generation-messages";
import { cultivationGenerationBlockReason, cultivationRefundNotice, quotaText, requiredCultivationCapabilities } from "@/features/cultivation/utils";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { deleteGenerationHistoryRecords, loadGenerationHistoryPage, migrateLocalGenerationHistoryOnce, persistGenerationHistoryRecord } from "@/services/generation-history";
import { mergePersistedImagesIntoHistoryRecord, mergeServerJobsIntoImageHistory, serverJobModelValue } from "@/services/image-generation-history";
import { archiveDeferredServerJob, fetchServerJobs, type ServerJob } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { lazyRoute } from "@/lib/lazy-route";
import { creativeImageTransferState, type CreativeImageTransfer } from "@/lib/creative-image-transfer";
import { preloadRoute } from "@/lib/route-loaders";
import type { ResultContinueAction } from "./result-image-card";

const loadPromptSelectDialog = () => import("@/components/prompts/prompt-select-dialog").then((module) => ({ default: module.PromptSelectDialog }));
const loadAssetPickerModal = () => import("@/components/canvas/asset-picker-modal").then((module) => ({ default: module.AssetPickerModal }));
const PromptSelectDialog = lazyRoute(loadPromptSelectDialog);
const AssetPickerModal = lazyRoute(loadAssetPickerModal);
const ResultImageCard = lazyRoute(() => import("./result-image-card").then((module) => ({ default: module.ResultImageCard })));
const FailedImageCard = lazyRoute(() => import("./failed-image-card").then((module) => ({ default: module.FailedImageCard })));
const ImageSettingsPanel = lazyRoute(() => import("@/components/image-settings-panel").then((module) => ({ default: module.ImageSettingsPanel })));

const preloadPromptSelectDialog = () => void loadPromptSelectDialog().catch(() => undefined);
const preloadAssetPickerModal = () => void loadAssetPickerModal().catch(() => undefined);
const HISTORY_PAGE_SIZE = 18;
const HISTORY_SEARCH_DELAY_MS = 350;

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

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "imageQuality" | "imageOutputFormat" | "size" | "count" | "background">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

let logStorePromise: Promise<ReturnType<(typeof import("localforage"))["createInstance"]>> | undefined;

function getLogStore() {
    if (!logStorePromise) {
        logStorePromise = import("localforage").then(({ default: localforage }) => localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" }));
    }
    return logStorePromise;
}

export default function ImagePage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: cultivationProfile } = useCultivationProfile();
    const { generationSuccessMessage, isDouEmperor } = useImperialMode();
    const imperialGenerationCue = useImperialGenerationCue();
    const authenticatedUserId = useUserStore((state) => state.user?.id || "");
    const historyUserId = PUBLIC_MODE ? authenticatedUserId : "local";
    const fileInputRef = useRef<HTMLInputElement>(null);
    const replaceFileInputRef = useRef<HTMLInputElement>(null);
    const replacementIndexRef = useRef<number | null>(null);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [historySearchDraft, setHistorySearchDraft] = useState("");
    const [historySearch, setHistorySearch] = useState("");
    const [historyModel, setHistoryModel] = useState("");
    const [historyStatus, setHistoryStatus] = useState<"" | "success" | "failure">("");
    const [historyPage, setHistoryPage] = useState(1);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyModels, setHistoryModels] = useState<string[]>([]);
    const [historyRevision, setHistoryRevision] = useState(0);
    const [historyLoadError, setHistoryLoadError] = useState("");
    const [resultView, setResultView] = useState<"results" | "history">("results");
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [savingAssetIds, setSavingAssetIds] = useState<string[]>([]);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [previewReference, setPreviewReference] = useState<ReferenceImage | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deletingLogs, setDeletingLogs] = useState(false);
    const [logsLoading, setLogsLoading] = useState(false);
    const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const savingAssetIdsRef = useRef(new Set<string>());
    const historyArchiveRunsRef = useRef(new Set<string>());
    const historyRequestRef = useRef(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const generationJob = useSyncExternalStore(subscribeImageGeneration, getImageGenerationSnapshot, getImageGenerationSnapshot);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const resolvedImageSettings = resolveImageModelSettings(effectiveConfig, model, 10);
    const requestImageConfig = resolvedImageSettings.config;
    const activeImageCapabilities = resolvedImageSettings.capabilities;
    const appliedImageQuality = requestImageConfig.imageQuality;
    const generationCount = Number(requestImageConfig.count);
    const requiredCapabilities = requiredCultivationCapabilities({ model, quality: requestImageConfig.quality, referenceCount: references.length, hasMask: false });
    const referenceLimitReason = references.length > activeImageCapabilities.maxReferences ? `当前模型最多支持 ${activeImageCapabilities.maxReferences} 张参考图，请先移除多余图片` : null;
    const generationBlockReason =
        referenceLimitReason ||
        (cultivationProfile
            ? cultivationGenerationBlockReason({
                  remainingToday: cultivationProfile.remainingToday,
                  unlimited: cultivationProfile.unlimited,
                  maxConcurrency: cultivationProfile.maxConcurrency,
                  capabilities: cultivationProfile.capabilities,
                  requestedCount: generationCount,
                  requiredCapabilities,
              })
            : null);
    const canGenerate = Boolean(prompt.trim()) && !generationBlockReason;
    const running = generationJob?.status === "running";
    const generateButtonLabel = isDouEmperor ? (running || imperialGenerationCue.active ? "天地法则演化中……" : "执笔天地") : running ? "生成中……" : "开始生成";
    const elapsedMs = generationJob?.elapsedMs || 0;
    const results: GenerationResult[] = previewLog
        ? previewLog.images.length
            ? previewLog.images.map((image) => ({ id: image.id, status: "success", image }))
            : previewLog.status === "失败"
              ? [{ id: previewLog.id, status: "failed", error: "该次创作未留下可预览的画卷" }]
              : []
        : generationJob?.results || [];
    const previewReferenceIndex = previewReference ? references.findIndex((item) => item.id === previewReference.id) : -1;
    const archivedGenerationImages = (generationJob?.results || []).flatMap((result) => {
        const image = result.image;
        return result.status === "success" && image?.persisted !== false && image?.serverJobId ? [image] : [];
    });
    const archivedResultSignature = archivedGenerationImages.map((image) => `${image.id}:${image.dataUrl}`).join("|");

    useEffect(() => {
        if (!generationJob) return;
        setPrompt((value) => value || generationJob.prompt);
        setReferences((value) => (value.length ? value : generationJob.references));
    }, [generationJob?.id]);

    const uploadReference = async (input: Blob, name: string): Promise<ReferenceImage> => {
        const image = await uploadImage(input, { thumbnailMaxEdge: 1280 });
        return {
            id: nanoid(),
            name,
            type: image.mimeType,
            dataUrl: image.url,
            storageKey: image.storageKey,
            thumbnailKey: image.thumbnailKey,
            thumbnailUrl: image.thumbnailUrl,
        };
    };

    const appendReferences = async (entries: Array<{ input: Blob; name: string }>, successMessage?: string) => {
        const limited = limitImageReferenceAdditions(references, entries, activeImageCapabilities.maxReferences);
        if (limited.rejected) message.warning(`当前模型最多支持 ${activeImageCapabilities.maxReferences} 张参考图，已忽略 ${limited.rejected} 张`);
        if (!limited.accepted.length) return;
        try {
            const nextReferences = await Promise.all(limited.accepted.map((entry) => uploadReference(entry.input, entry.name)));
            setReferences((value) => limitImageReferenceAdditions(value, nextReferences, activeImageCapabilities.maxReferences).items as ReferenceImage[]);
            if (successMessage) message.success(successMessage.replace("{count}", String(nextReferences.length)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图上传失败");
        }
    };

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        await appendReferences(imageFiles.map((file) => ({ input: file, name: file.name })));
    };

    const addReferencesFromClipboard = async () => {
        try {
            if (!navigator.clipboard?.read) throw new Error("clipboard-read-unsupported");
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.warning("剪贴板里没有图片，请先复制图片后再粘贴");
                return;
            }
            await appendReferences(
                blobs.map((blob, index) => ({ input: blob, name: `clipboard-${index + 1}.png` })),
                "已读取 {count} 张参考图",
            );
        } catch (error) {
            const errorName = error instanceof DOMException ? error.name : error instanceof Error ? error.message : "";
            if (errorName === "NotAllowedError" || errorName === "SecurityError") {
                message.warning("浏览器未授权按钮读取剪贴板，请先复制图片，再按 Ctrl/Cmd+V");
            } else if (errorName === "clipboard-read-unsupported") {
                message.warning("当前浏览器不支持按钮读取剪贴板，请先复制图片，再按 Ctrl/Cmd+V");
            } else {
                message.error("读取剪贴板图片失败，请改用 Ctrl/Cmd+V 或上传图片");
            }
        }
    };

    const replaceReference = async (index: number, file?: File) => {
        if (!file || !file.type.startsWith("image/")) {
            message.warning("请选择一张图片替换当前参考图");
            return;
        }
        try {
            const replacement = await uploadReference(file, file.name);
            setReferences((value) => value.map((item, itemIndex) => (itemIndex === index ? replacement : item)));
            setPreviewReference(null);
            message.success("参考图已替换");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图替换失败");
        }
    };

    const openReferenceReplacement = (index: number) => {
        replacementIndexRef.current = index;
        replaceFileInputRef.current?.click();
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
        setResultView("results");
        setPreviewLog(null);
        const jobId = startImageGeneration(
            snapshot,
            generationCount,
            async ({ successImages, successCount, failCount, error, durationMs }) => {
                void queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey });
                const failureFeedback = successCount ? undefined : generationFailureFeedback(error, { isDouEmperor });
                if (agentTaskId)
                    updateAgentTask(agentTaskId, {
                        status: successCount ? "succeeded" : "failed",
                        successCount,
                        failCount,
                        error: failureFeedback ? generationFailureText(failureFeedback) : undefined,
                    });
                const logImages = await Promise.all(
                    successImages.map(async (image) => {
                        if (image.persisted === false) return image;
                        const stored = await uploadImage(image.dataUrl, { outputFormat: snapshot.config.imageOutputFormat });
                        return {
                            ...image,
                            dataUrl: stored.url,
                            storageKey: stored.storageKey,
                            thumbnailKey: stored.thumbnailKey,
                            thumbnailUrl: stored.thumbnailUrl,
                            width: stored.width,
                            height: stored.height,
                            bytes: stored.bytes,
                            mimeType: stored.mimeType,
                        };
                    }),
                );
                logImages.forEach(replaceImageGenerationResult);
                saveLog(
                    buildLog({
                        prompt: text,
                        model: requestImageConfig.imageModel,
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
                    const settlement = failCount ? `成功 ${successCount} 张，失败 ${failCount} 张${cultivationRefundNotice(cultivationProfile?.unlimited, "failed")}` : `成功生成 ${successCount} 张图片`;
                    message.success(generationSuccessMessage(settlement));
                } else if (failureFeedback) {
                    message.error({
                        content: <GenerationFailureToast feedback={failureFeedback} supplementary={cultivationRefundNotice(cultivationProfile?.unlimited, "all").replace(/^，/, "")} />,
                        duration: 2,
                    });
                }
            },
            undefined,
            resolveImageSlotConcurrency(resolvedImageSettings.channel.baseUrl, model, cultivationProfile?.maxConcurrency || generationCount),
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
        if (image.persisted === false) {
            window.open(image.dataUrl, "_blank", "noopener,noreferrer");
            message.info("临时原图已在新标签页打开");
            return;
        }
        try {
            const outputFormat = previewLog?.config.imageOutputFormat || generationJob?.snapshot?.config.imageOutputFormat || effectiveConfig.imageOutputFormat;
            const blob = await convertImageOutput(image.dataUrl, outputFormat);
            const { saveAs } = await import("file-saver");
            saveAs(blob, `image-${index + 1}.${imageFileExtension(blob.type)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载图片失败");
        }
    };

    const ensureStoredResult = async (image: GeneratedImage) => {
        if (image.persisted === false) throw new Error("图片仍在处理中，请稍候");
        if (image.storageKey) return image;
        const outputFormat = previewLog?.config.imageOutputFormat || generationJob?.snapshot?.config.imageOutputFormat || effectiveConfig.imageOutputFormat;
        const stored = await uploadImage(image.dataUrl, { outputFormat, thumbnailMaxEdge: 1280 });
        const nextImage = {
            ...image,
            dataUrl: stored.url,
            storageKey: stored.storageKey,
            thumbnailKey: stored.thumbnailKey,
            thumbnailUrl: stored.thumbnailUrl,
            width: stored.width,
            height: stored.height,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
        };
        replaceImageGenerationResult(nextImage);
        setPreviewLog((log) => (log ? { ...log, images: log.images.map((item) => (item.id === image.id ? nextImage : item)) } : log));
        return nextImage;
    };

    const resultReference = async (image: GeneratedImage, index: number): Promise<ReferenceImage> => {
        const stored = await ensureStoredResult(image);
        return {
            id: nanoid(),
            name: `result-${index + 1}.${imageFileExtension(stored.mimeType || "image/png")}`,
            type: stored.mimeType || "image/*",
            dataUrl: stored.dataUrl,
            storageKey: stored.storageKey,
            thumbnailKey: stored.thumbnailKey,
            thumbnailUrl: stored.thumbnailUrl,
        };
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        if (references.length >= activeImageCapabilities.maxReferences) {
            message.warning(`当前模型最多支持 ${activeImageCapabilities.maxReferences} 张参考图`);
            return;
        }
        const reference = await resultReference(image, index);
        setReferences((value) => limitImageReferenceAdditions(value, [reference], activeImageCapabilities.maxReferences).items as ReferenceImage[]);
        message.success("已追加为参考图");
    };

    const restartFromResult = async (image: GeneratedImage, index: number) => {
        if (running) {
            message.warning("当前任务仍在生成，请等待完成后再开始新作");
            return;
        }
        if (activeImageCapabilities.maxReferences < 1) {
            message.warning("当前模型不支持参考图，请先切换支持图生图的模型");
            return;
        }
        const reference = await resultReference(image, index);
        clearImageGenerationJob();
        setPrompt("");
        setReferences([reference]);
        setSelectedLogIds([]);
        setPreviewLog(null);
        setResultView("results");
        updateConfig("count", "1");
        message.success("已清空旧内容并将当前图片设为唯一参考图");
    };

    const buildResultTransfer = async (image: GeneratedImage, index: number): Promise<CreativeImageTransfer> => {
        const stored = await ensureStoredResult(image);
        const sourcePrompt = previewLog ? generationUserPrompt(previewLog.prompt) : generationJob?.snapshot?.text || prompt;
        return {
            id: `${stored.id}:${Date.now()}`,
            source: "image-workbench",
            title: `丹青台生成结果 ${index + 1}`,
            prompt: sourcePrompt,
            dataUrl: stored.dataUrl,
            storageKey: stored.storageKey,
            thumbnailKey: stored.thumbnailKey,
            thumbnailUrl: stored.thumbnailUrl,
            width: stored.width,
            height: stored.height,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
        };
    };

    const sendResultToCanvas = async (image: GeneratedImage, index: number) => {
        const transfer = await buildResultTransfer(image, index);
        void preloadRoute("/canvas");
        navigate("/canvas?mode=transfer", { state: creativeImageTransferState(transfer) });
    };

    const sendResultToColorAlchemy = async (image: GeneratedImage, index: number) => {
        const transfer = await buildResultTransfer(image, index);
        void preloadRoute("/color-alchemy");
        navigate("/color-alchemy", { state: creativeImageTransferState(transfer) });
    };

    const repeatOriginalGeneration = () => {
        if (running) {
            message.warning("当前任务仍在生成，请等待完成后再生成一组");
            return;
        }
        if (previewLog) {
            continueFromGenerationLog(previewLog);
            setAutoRunToken((value) => value + 1);
            message.info("正在按太古遗迹中的原参数再次生成");
            return;
        }
        const snapshot = generationJob?.snapshot;
        if (!snapshot) {
            message.warning("未找到本次生成参数");
            return;
        }
        const selectedModel = snapshot.config.imageModel || snapshot.config.model;
        const repeatCount = Math.max(1, generationJob?.results.length || Number(snapshot.config.count) || 1);
        const restored = resolveImageModelSettings({ ...effectiveConfig, ...snapshot.config, model: selectedModel, imageModel: selectedModel, count: String(repeatCount) }, selectedModel, 10).config;
        setPrompt(snapshot.text);
        setReferences(snapshot.references);
        updateConfig("imageModel", restored.imageModel);
        updateConfig("quality", restored.quality);
        updateConfig("imageQuality", restored.imageQuality);
        updateConfig("imageOutputFormat", restored.imageOutputFormat);
        updateConfig("size", restored.size);
        updateConfig("count", restored.count);
        updateConfig("background", restored.background);
        setPreviewLog(null);
        setResultView("results");
        setAutoRunToken((value) => value + 1);
        message.info("正在按原参数再次生成");
    };

    const continueFromResult = async (action: ResultContinueAction, image: GeneratedImage, index: number) => {
        try {
            if (action === "restart") await restartFromResult(image, index);
            else if (action === "append-reference") await addResultToReferences(image, index);
            else if (action === "canvas") await sendResultToCanvas(image, index);
            else if (action === "color-alchemy") await sendResultToColorAlchemy(image, index);
            else repeatOriginalGeneration();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "继续创作失败，请重试");
        }
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        if (savingAssetIdsRef.current.has(image.id)) return;
        savingAssetIdsRef.current.add(image.id);
        setSavingAssetIds((ids) => [...ids, image.id]);
        try {
            // Generated results are already persisted by the job flow. Reusing that asset avoids a
            // duplicate upload and prevents upstream MIME headers from affecting asset registration.
            const result = await ensureStoredResult(image);
            addAsset({
                kind: "image",
                title: `生成结果 ${index + 1}`,
                coverUrl: result.thumbnailUrl || result.dataUrl,
                tags: [],
                source: IMAGE_WORKBENCH_ASSET_SOURCE,
                data: {
                    dataUrl: result.dataUrl,
                    storageKey: result.storageKey,
                    thumbnailKey: result.thumbnailKey,
                    thumbnailUrl: result.thumbnailUrl,
                    width: result.width,
                    height: result.height,
                    bytes: result.bytes,
                    mimeType: result.mimeType || "image/*",
                },
                metadata: { source: "image-page", prompt },
            });
            message.success("已入藏卷阁");
        } catch (error) {
            console.error("Failed to save generated image as an asset", error);
            message.error(error instanceof Error ? `入藏卷阁失败：${error.message}` : "入藏卷阁失败，请重试");
        } finally {
            savingAssetIdsRef.current.delete(image.id);
            setSavingAssetIds((ids) => ids.filter((id) => id !== image.id));
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const limited = limitImageReferenceAdditions(references, [payload], activeImageCapabilities.maxReferences);
            if (!limited.added) {
                message.warning(`当前模型最多支持 ${activeImageCapabilities.maxReferences} 张参考图`);
                return;
            }
            const stored = await uploadImage(payload.dataUrl, { thumbnailMaxEdge: 1280 });
            const reference = {
                id: nanoid(),
                name: payload.title,
                type: stored.mimeType,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                thumbnailKey: stored.thumbnailKey,
                thumbnailUrl: stored.thumbnailUrl,
            };
            setReferences((value) => limitImageReferenceAdditions(value, [reference], activeImageCapabilities.maxReferences).items as ReferenceImage[]);
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
        setResultView("results");
    };

    const deleteSelectedLogs = async () => {
        const deletingIds = [...selectedLogIds];
        if (!deletingIds.length || deletingLogs) return;
        const selected = logs.filter((log) => deletingIds.includes(log.id));
        const serverJobIds = Array.from(new Set(selected.flatMap((log) => log.serverJobIds || [])));
        setDeletingLogs(true);
        try {
            const logStore = await getLogStore();
            await deleteGenerationHistoryRecords({ kind: "image", userId: historyUserId, store: logStore }, deletingIds, serverJobIds);
            setHistoryRevision((value) => value + 1);
            if (previewLog && deletingIds.includes(previewLog.id)) setPreviewLog(null);
            setSelectedLogIds([]);
            setDeleteConfirmOpen(false);
            message.success(`已从太古遗迹移除 ${deletingIds.length} 条记录`);
        } catch (error) {
            console.error("Failed to delete image generation history", error);
            message.error("太古遗迹记录删除失败，请稍后重试");
        } finally {
            setDeletingLogs(false);
        }
    };

    const refreshHistoryPage = useCallback(async () => {
        if (resultView !== "history") return;
        const requestId = historyRequestRef.current + 1;
        historyRequestRef.current = requestId;
        setLogsLoading(true);
        setHistoryLoadError("");
        try {
            const logStore = await getLogStore();
            const options = { kind: "image" as const, userId: historyUserId, store: logStore, hydrate: normalizeLog, prepare: prepareImageLogForServer };
            let pageResult = await loadGenerationHistoryPage(options, {
                page: historyPage,
                pageSize: HISTORY_PAGE_SIZE,
                search: historySearch,
                model: historyModel,
                status: historyStatus || undefined,
            });

            if (historyRequestRef.current !== requestId) return;
            setLogs(pageResult.items);
            setHistoryPage(pageResult.page);
            setHistoryTotal(pageResult.total);
            setHistoryModels(pageResult.models);
            setSelectedLogIds([]);

            if (PUBLIC_MODE && historyUserId && pageResult.page === 1 && !historySearch && !historyModel && !historyStatus) {
                void (async () => {
                    try {
                        const jobs = (await fetchServerJobs(historyUserId)).items;
                        if (historyRequestRef.current !== requestId) return;
                        const merged = mergeServerJobsIntoImageHistory(pageResult.items, jobs, buildLogFromServerJob);
                        if (imageHistoryChanged(pageResult.items, merged)) {
                            const previousById = new Map(pageResult.items.map((log) => [log.id, log]));
                            const changedLogs = merged.filter((log) => {
                                const current = previousById.get(log.id);
                                return !current || imageHistoryChanged([current], [log]);
                            });
                            await settleWithConcurrency(changedLogs, 2, (log) => persistGenerationHistoryRecord(options, { ...serializeLog(log), updatedAt: Date.now() }));
                            if (historyRequestRef.current !== requestId) return;
                            const refreshedPage = await loadGenerationHistoryPage(options, {
                                page: 1,
                                pageSize: HISTORY_PAGE_SIZE,
                            });
                            if (historyRequestRef.current !== requestId) return;
                            setLogs(refreshedPage.items);
                            setHistoryPage(refreshedPage.page);
                            setHistoryTotal(refreshedPage.total);
                            setHistoryModels(refreshedPage.models);
                            setSelectedLogIds([]);
                        }
                        const pendingJobs = jobs.filter((job) => job.status === "succeeded" && job.result?.recoveryPending && !historyArchiveRunsRef.current.has(job.id));
                        if (pendingJobs.length) {
                            pendingJobs.forEach((job) => historyArchiveRunsRef.current.add(job.id));
                            void settleWithConcurrency(pendingJobs, 2, (job) => archiveDeferredServerJob(job, historyUserId)).then((outcomes) => {
                                pendingJobs.forEach((job) => historyArchiveRunsRef.current.delete(job.id));
                                if (historyRequestRef.current === requestId && outcomes.some((outcome) => outcome.status === "fulfilled" && !outcome.value.result?.recoveryPending)) setHistoryRevision((value) => value + 1);
                            });
                        }
                    } catch {
                        // Paginated history is already visible if recent task recovery is temporarily unavailable.
                    }
                })();
            }
        } catch (error) {
            if (historyRequestRef.current !== requestId) return;
            console.error("Failed to load image generation history page", error);
            setHistoryLoadError(error instanceof Error ? error.message : "太古遗迹载入失败");
            setLogs([]);
            setHistoryTotal(0);
        } finally {
            if (historyRequestRef.current === requestId) setLogsLoading(false);
        }
    }, [historyModel, historyPage, historySearch, historyStatus, historyUserId, resultView]);

    const saveLog = (log: GenerationLog) => {
        void getLogStore()
            .then((logStore) => persistGenerationHistoryRecord({ kind: "image", userId: historyUserId, store: logStore, hydrate: normalizeLog, prepare: prepareImageLogForServer }, { ...serializeLog(log), updatedAt: Date.now() }))
            .then(() => {
                setHistoryPage(1);
                setHistoryRevision((value) => value + 1);
            });
    };

    useEffect(() => {
        const delayHandle = window.setTimeout(() => {
            const normalized = historySearchDraft.trim();
            setHistorySearch((current) => {
                if (current === normalized) return current;
                setHistoryPage(1);
                return normalized;
            });
        }, HISTORY_SEARCH_DELAY_MS);
        return () => {
            window.clearTimeout(delayHandle);
        };
    }, [historySearchDraft]);

    useEffect(() => {
        if (resultView !== "history") return;
        void refreshHistoryPage();
    }, [historyRevision, refreshHistoryPage, resultView]);

    useEffect(() => {
        if (!PUBLIC_MODE || !historyUserId) return;
        let canceled = false;
        const delayHandle = window.setTimeout(() => {
            void getLogStore()
                .then((logStore) => migrateLocalGenerationHistoryOnce({ kind: "image", userId: historyUserId, store: logStore, hydrate: normalizeLog, prepare: prepareImageLogForServer }))
                .then((migrated) => {
                    if (!canceled && migrated) setHistoryRevision((value) => value + 1);
                })
                .catch((error) => console.error("Failed to migrate local image generation history", error));
        }, 2_000);
        return () => {
            canceled = true;
            window.clearTimeout(delayHandle);
        };
    }, [historyUserId]);

    useEffect(() => {
        if (!archivedResultSignature || !logs.length) return;
        const nextLogs = logs.map((log) => mergePersistedImagesIntoHistoryRecord(log, archivedGenerationImages));
        const changedLogs = nextLogs.filter((log, index) => log !== logs[index]);
        if (!changedLogs.length) return;
        setLogs(nextLogs);
        changedLogs.forEach(saveLog);
        setPreviewLog((log) => (log ? mergePersistedImagesIntoHistoryRecord(log, archivedGenerationImages) : log));
    }, [archivedResultSignature, historyUserId, logs]);

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setResultView("results");
    };

    const continueFromGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setResultView("results");
        setPrompt(generationUserPrompt(log.prompt));
        setReferences(log.references || []);
        const selectedModel = log.config.imageModel || log.model;
        const restored = resolveImageModelSettings({ ...effectiveConfig, ...log.config, model: selectedModel, imageModel: selectedModel }, selectedModel, 10).config;
        updateConfig("imageModel", restored.imageModel);
        updateConfig("quality", restored.quality);
        updateConfig("imageQuality", restored.imageQuality);
        updateConfig("imageOutputFormat", restored.imageOutputFormat);
        updateConfig("size", restored.size);
        updateConfig("count", restored.count);
        updateConfig("background", restored.background);
        message.success("已恢复提示词与生成参数");
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
        if (references.length > activeImageCapabilities.maxReferences) {
            message.warning(`当前模型最多支持 ${activeImageCapabilities.maxReferences} 张参考图，请先移除多余图片`);
            return null;
        }
        return { text, config: { ...requestImageConfig, model: requestImageConfig.imageModel, count: "1" }, references: [...references] };
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        if (generationBlockReason) {
            message.warning(generationBlockReason);
            return;
        }
        setResultView("results");
        setPreviewLog(null);
        const retryStartedAt = Date.now();
        try {
            const image = await retryImageGeneration(index, snapshot);
            if (!image) return;
            const logImage =
                image.persisted === false
                    ? image
                    : await uploadImage(image.dataUrl, { outputFormat: snapshot.config.imageOutputFormat }).then((stored) => ({
                          ...image,
                          dataUrl: stored.url,
                          storageKey: stored.storageKey,
                          thumbnailKey: stored.thumbnailKey,
                          thumbnailUrl: stored.thumbnailUrl,
                          width: stored.width,
                          height: stored.height,
                          bytes: stored.bytes,
                          mimeType: stored.mimeType,
                      }));
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
            <main
                className="min-h-0 flex-1 overflow-y-auto p-3 lg:overflow-hidden"
                onPaste={(event) => {
                    const files = getClipboardImageFiles(event.clipboardData);
                    if (!files.length) return;
                    event.preventDefault();
                    void appendReferences(
                        files.map((file) => ({ input: file, name: file.name || "clipboard-image.png" })),
                        "已粘贴 {count} 张参考图",
                    );
                }}
            >
                <section className="grid min-h-0 min-w-0 w-full gap-3 lg:h-full lg:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
                    <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:h-full">
                        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
                            {/* 丹青台 · 场景横幅(仅 UI,逻辑不变) */}
                            <div className="relative mb-6 overflow-hidden rounded-lg">
                                <img src="/images/ref/energy-vortex-2.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e12]/88 via-[#0e0e12]/62 to-[#0e0e12]/28" aria-hidden />
                                <div className="relative p-5">
                                    <div className="min-w-0">
                                        <p className="text-[10px] tracking-[0.4em] text-[#c9a86a]">DAN QING TAI</p>
                                        <h1 className="font-brush mt-2 text-4xl text-[#edede6] [text-shadow:0_2px_20px_rgb(0_0_0/0.6)]">丹青台</h1>
                                        <p className="font-display mt-1.5 text-xs tracking-[0.1em] text-[#edede6]/70">一笔落墨,万象皆成 · 结果在这里持续保留</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 space-y-5">
                                <div>
                                    <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <span className="text-base font-semibold">提示词</span>
                                        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                                            <ImagePromptOptimizer
                                                prompt={prompt}
                                                context={{
                                                    imageModel: model,
                                                    aspectRatio: requestImageConfig.size,
                                                    resolution: requestImageConfig.quality,
                                                    referenceCount: references.length,
                                                    editMode: references.length > 0,
                                                    source: "workbench",
                                                }}
                                                onAdopt={setPrompt}
                                            />
                                            <Button
                                                className="min-w-0"
                                                size="small"
                                                icon={<BookOpen className="size-3.5" />}
                                                onPointerEnter={preloadPromptSelectDialog}
                                                onFocus={preloadPromptSelectDialog}
                                                onPointerDown={preloadPromptSelectDialog}
                                                onClick={() => setPromptDialogOpen(true)}
                                            >
                                                提示词库
                                            </Button>
                                            <Button
                                                className="min-w-0"
                                                size="small"
                                                icon={<FolderPlus className="size-3.5" />}
                                                onPointerEnter={preloadAssetPickerModal}
                                                onFocus={preloadAssetPickerModal}
                                                onPointerDown={preloadAssetPickerModal}
                                                onClick={() => setAssetPickerOpen(true)}
                                            >
                                                藏卷阁
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
                                            <span className="ml-2 text-xs text-stone-400">可上传、粘贴，点击图片预览，右上角可替换</span>
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
                                        className="hover-scrollbar hover-scrollbar-hint flex min-h-32 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700"
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
                                            <div key={item.id} className="group relative size-24 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900 sm:size-28">
                                                <button type="button" className="block size-full cursor-zoom-in p-0" onClick={() => setPreviewReference(item)} aria-label={`预览${imageReferenceLabel(index)}：${item.name}`}>
                                                    <img src={item.thumbnailUrl || item.dataUrl} alt={item.name} className="size-full object-cover" decoding="async" />
                                                </button>
                                                <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                                <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                                <Tooltip title="替换参考图">
                                                    <button
                                                        type="button"
                                                        className="absolute right-8 top-1 flex size-6 items-center justify-center rounded bg-black/60 text-white transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            openReferenceReplacement(index);
                                                        }}
                                                        aria-label="替换参考图"
                                                    >
                                                        <RefreshCw className="size-3.5" />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip title="移除参考图">
                                                    <button
                                                        type="button"
                                                        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-black/60 text-white transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setReferences((value) => value.filter((ref) => ref.id !== item.id));
                                                        }}
                                                        aria-label="移除参考图"
                                                    >
                                                        <Trash2 className="size-3.5" />
                                                    </button>
                                                </Tooltip>
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
                                    <details className="group" onToggle={(event) => setAdvancedSettingsOpen(event.currentTarget.open)}>
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:content-none">
                                            <span className="inline-flex shrink-0 items-center gap-2">
                                                <SlidersHorizontal className="size-4 text-stone-500" />
                                                高级参数
                                            </span>
                                            <span className="flex min-w-0 items-center gap-1.5 text-stone-500 dark:text-stone-400">
                                                <span className="truncate text-xs font-normal">
                                                    {imageSizeLabel(requestImageConfig.size)} · {imageResolutionLabel(requestImageConfig.quality)} · {imageGenerationQualityLabel(appliedImageQuality)} ·{" "}
                                                    {imageOutputFormatLabel(requestImageConfig.imageOutputFormat)}
                                                </span>
                                                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                            </span>
                                        </summary>
                                        {advancedSettingsOpen ? (
                                            <div className="border-t border-stone-200 p-3 dark:border-stone-800">
                                                <GenerationSettings config={requestImageConfig} updateConfig={updateConfig} />
                                            </div>
                                        ) : null}
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

                    <section className="relative min-h-0 overflow-hidden rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:h-full">
                        <div className="thin-scrollbar relative min-h-0 overflow-y-auto p-4 lg:h-full lg:p-5">
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-2">
                                    <h2 className="text-xl font-semibold">{resultView === "results" ? "生成结果" : "太古遗迹"}</h2>
                                    {resultView === "results" && previewLog ? <Tag className="m-0">遗迹预览</Tag> : null}
                                    {resultView === "history" ? <Tag className="m-0">{historyTotal}</Tag> : null}
                                    {running ? <Tag className="m-0 px-2 py-1">已等待 {formatDuration(elapsedMs)}</Tag> : null}
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
                                    {resultView === "results" && previewLog ? (
                                        <Button size="small" type="text" icon={<ArrowLeft className="size-3.5" />} onClick={() => setPreviewLog(null)}>
                                            返回本次
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
                                        <Button
                                            size="small"
                                            icon={<Archive className="size-3.5" />}
                                            onClick={() => {
                                                setResultView("history");
                                            }}
                                        >
                                            太古遗迹
                                        </Button>
                                    )}
                                    <Tooltip title="开始新作">
                                        <Button aria-label="开始新作" size="small" type="text" icon={<Plus className="size-4" />} onClick={createSession} />
                                    </Tooltip>
                                </div>
                            </div>
                            {resultView === "history" ? (
                                <div>
                                    <HistoryFilters
                                        search={historySearchDraft}
                                        model={historyModel}
                                        status={historyStatus}
                                        models={historyModels.map((value) => ({ value, label: modelOptionLabel(effectiveConfig, value) }))}
                                        loading={logsLoading}
                                        onSearchChange={setHistorySearchDraft}
                                        onModelChange={(value) => {
                                            setHistoryModel(value);
                                            setHistoryPage(1);
                                        }}
                                        onStatusChange={(value) => {
                                            setHistoryStatus(value);
                                            setHistoryPage(1);
                                        }}
                                        onReset={() => {
                                            setHistorySearchDraft("");
                                            setHistorySearch("");
                                            setHistoryModel("");
                                            setHistoryStatus("");
                                            setHistoryPage(1);
                                            setHistoryRevision((value) => value + 1);
                                        }}
                                        onRefresh={() => setHistoryRevision((value) => value + 1)}
                                    />
                                    {logsLoading && !logs.length ? (
                                        <HistoryLoading />
                                    ) : (
                                        <LogPanel
                                            logs={logs}
                                            selectedLogIds={selectedLogIds}
                                            activeLogId={previewLog?.id}
                                            loading={logsLoading}
                                            error={historyLoadError}
                                            page={historyPage}
                                            pageSize={HISTORY_PAGE_SIZE}
                                            total={historyTotal}
                                            filtered={Boolean(historySearch || historyModel || historyStatus)}
                                            onPageChange={setHistoryPage}
                                            onRetry={() => setHistoryRevision((value) => value + 1)}
                                            onResetFilters={() => {
                                                setHistorySearchDraft("");
                                                setHistorySearch("");
                                                setHistoryModel("");
                                                setHistoryStatus("");
                                                setHistoryPage(1);
                                            }}
                                            onSelectedLogIdsChange={setSelectedLogIds}
                                            onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                            onPreviewLog={previewGenerationLog}
                                            onContinueLog={continueFromGenerationLog}
                                        />
                                    )}
                                </div>
                            ) : results.length ? (
                                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                    {results.map((result, index) =>
                                        result.status === "success" && result.image ? (
                                            <Suspense key={result.id} fallback={<ResultImageCardLoading />}>
                                                <ResultImageCard image={result.image} index={index} savingAsset={savingAssetIds.includes(result.image.id)} onContinue={continueFromResult} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                            </Suspense>
                                        ) : result.status === "failed" ? (
                                            <Suspense key={result.id} fallback={<ResultImageCardLoading />}>
                                                <FailedImageCard id={result.id} error={result.error} isDouEmperor={isDouEmperor} onRetry={() => retryResult(index)} />
                                            </Suspense>
                                        ) : (
                                            <PendingImageCard key={result.id} />
                                        ),
                                    )}
                                </div>
                            ) : (
                                <div className="relative flex min-h-56 flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#d9c8a7]/30 bg-[#151b1e] text-center lg:min-h-[calc(100%_-_3rem)] [&_.empty-state-desc]:!text-[#eee6d8] [&_.empty-state-icon]:!border-[#efe4d0]/30 [&_.empty-state-icon]:!bg-[#11171b]/65 [&_.empty-state-icon]:!text-[#e4c78d] [&_.empty-state-title]:!text-[#fffaf0]">
                                    <img
                                        src="/images/ref/danqing-results-taiji-ink.webp"
                                        alt=""
                                        aria-hidden="true"
                                        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
                                        loading="eager"
                                        decoding="async"
                                        fetchPriority="high"
                                    />
                                    <div className="pointer-events-none absolute inset-0 bg-[#081014]/20" aria-hidden="true" />
                                    <div className="empty-state relative z-10 !p-8 [text-shadow:0_2px_12px_rgba(0,0,0,0.95)]">
                                        <span className="empty-state-icon">
                                            <ImagePlus className="size-5" />
                                        </span>
                                        <span className="empty-state-title">{running ? "正在准备生成结果" : "万象未生"}</span>
                                        <span className="empty-state-desc">{running ? "结果生成后会保留在这里" : "暂无生成结果，从左侧提示词落下第一笔。"}</span>
                                    </div>
                                </div>
                            )}
                        </div>
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
            <input
                ref={replaceFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const index = replacementIndexRef.current;
                    replacementIndexRef.current = null;
                    if (index !== null) void replaceReference(index, Array.from(event.target.files || [])[0]);
                    event.target.value = "";
                }}
            />
            {promptDialogOpen ? (
                <Suspense fallback={<DeferredDialogLoading title="提示词库" />}>
                    <PromptSelectDialog open onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
                </Suspense>
            ) : null}
            {assetPickerOpen ? (
                <Suspense fallback={<DeferredDialogLoading title="选择藏卷阁内容" />}>
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
                    <p className="text-sm text-stone-500 dark:text-stone-400">已入藏卷阁的图片不会受到影响。</p>
                </div>
            </Modal>
            <Modal
                title={previewReference?.name || "参考图预览"}
                open={Boolean(previewReference)}
                onCancel={() => setPreviewReference(null)}
                footer={
                    previewReferenceIndex >= 0 ? (
                        <Button
                            icon={<RefreshCw className="size-3.5" />}
                            onClick={() => {
                                setPreviewReference(null);
                                openReferenceReplacement(previewReferenceIndex);
                            }}
                        >
                            替换此图
                        </Button>
                    ) : null
                }
                width={960}
            >
                <div className="flex max-h-[72vh] min-h-40 items-center justify-center overflow-auto rounded-lg bg-stone-100 p-3 dark:bg-stone-900">
                    {previewReference ? <img src={previewReference.dataUrl} alt={previewReference.name} className="max-h-[68vh] max-w-full object-contain" /> : null}
                </div>
            </Modal>
        </div>
    );
}

function DeferredDialogLoading({ title }: { title: string }) {
    return (
        <Modal title={title} open footer={null} width={860}>
            <div className="grid min-h-48 place-items-center text-sm text-stone-500 dark:text-stone-400">
                <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在打开…
                </span>
            </div>
        </Modal>
    );
}

function HistoryLoading() {
    return (
        <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            <span className="inline-flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                正在整理太古遗迹…
            </span>
        </div>
    );
}

function ResultImageCardLoading() {
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">
            <div className="absolute inset-0 grid place-items-center text-sm text-stone-500 dark:text-stone-400">
                <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在载入结果…
                </span>
            </div>
        </div>
    );
}

function GenerationSettings({ config, updateConfig }: { config: AiConfig; updateConfig: UpdateAiConfig }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Suspense
            fallback={
                <div className="grid min-h-32 place-items-center text-sm text-stone-500 dark:text-stone-400">
                    <span className="inline-flex items-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在载入参数…
                    </span>
                </div>
            }
        >
            <ImageSettingsPanel config={config} selectedModel={config.imageModel || config.model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
        </Suspense>
    );
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

function HistoryFilters({
    search,
    model,
    status,
    models,
    loading,
    onSearchChange,
    onModelChange,
    onStatusChange,
    onReset,
    onRefresh,
}: {
    search: string;
    model: string;
    status: "" | "success" | "failure";
    models: Array<{ value: string; label: string }>;
    loading: boolean;
    onSearchChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onStatusChange: (value: "" | "success" | "failure") => void;
    onReset: () => void;
    onRefresh: () => void;
}) {
    const filtered = Boolean(search.trim() || model || status);
    return (
        <div className="mb-4 flex flex-col gap-2 border-b border-stone-200 pb-4 dark:border-stone-800 xl:flex-row xl:items-center">
            <Input
                value={search}
                allowClear
                maxLength={200}
                prefix={<Search className="size-4 text-stone-400" />}
                placeholder="搜索提示词"
                aria-label="搜索太古遗迹提示词"
                className="min-w-0 xl:max-w-md"
                onChange={(event) => onSearchChange(event.target.value)}
            />
            <Select value={model || undefined} allowClear showSearch optionFilterProp="label" placeholder="全部模型" aria-label="按模型筛选太古遗迹" className="w-full xl:w-56" options={models} onChange={(value) => onModelChange(value || "")} />
            <Select
                value={status || undefined}
                allowClear
                placeholder="全部状态"
                aria-label="按生成状态筛选太古遗迹"
                className="w-full xl:w-36"
                options={[
                    { value: "success", label: "生成成功" },
                    { value: "failure", label: "生成失败" },
                ]}
                onChange={(value) => onStatusChange(value || "")}
            />
            <div className="flex shrink-0 items-center justify-end gap-1">
                {filtered ? (
                    <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
                        重置
                    </Button>
                ) : null}
                <Tooltip title="刷新记录">
                    <Button aria-label="刷新太古遗迹" size="small" type="text" loading={loading} icon={<RefreshCw className="size-3.5" />} onClick={onRefresh} />
                </Tooltip>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    loading,
    error,
    page,
    pageSize,
    total,
    filtered,
    onPageChange,
    onRetry,
    onResetFilters,
    onSelectedLogIdsChange,
    onDeleteSelected,
    onPreviewLog,
    onContinueLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    loading: boolean;
    error: string;
    page: number;
    pageSize: number;
    total: number;
    filtered: boolean;
    onPageChange: (page: number) => void;
    onRetry: () => void;
    onResetFilters: () => void;
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
                <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">每次生成都会自动留下记录，满意的作品仍需手动入藏卷阁。</p>
                <div className="flex shrink-0 items-center gap-1">
                    {managing ? (
                        <>
                            <Button size="small" type="text" disabled={!logs.length} onClick={toggleAll}>
                                {allSelected ? "取消全选" : "本页全选"}
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
            <div className={`grid gap-3 transition-opacity sm:grid-cols-2 2xl:grid-cols-3 ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
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
                {!logs.length && error ? (
                    <div className="col-span-full flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-rose-300 px-6 text-center dark:border-rose-900/70">
                        <Archive className="mb-3 size-7 text-rose-400" />
                        <div className="text-sm font-medium">太古遗迹暂时无法载入</div>
                        <div className="mt-1 max-w-lg text-xs leading-5 text-stone-500">{error}</div>
                        <Button className="mt-4" size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
                            重新载入
                        </Button>
                    </div>
                ) : !logs.length ? (
                    <div className="col-span-full flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700">
                        <ImagePlus className="mb-3 size-7 text-stone-400" />
                        <div className="text-sm font-medium">{filtered ? "没有符合条件的记录" : "遗迹尚未留下痕迹"}</div>
                        <div className="mt-1 text-xs text-stone-500">{filtered ? "调整搜索词或筛选条件后再试。" : "完成第一次生成后，记录会自动出现在这里。"}</div>
                        {filtered ? (
                            <Button className="mt-4" size="small" icon={<RotateCcw className="size-3.5" />} onClick={onResetFilters}>
                                清除筛选
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {total > 0 ? (
                <div className="mt-5 flex justify-center border-t border-stone-200 pt-4 dark:border-stone-800">
                    <Pagination current={page} pageSize={pageSize} total={total} responsive showSizeChanger={false} showTotal={(count, range) => `${range[0]}-${range[1]} / ${count}`} disabled={loading} onChange={onPageChange} />
                </div>
            ) : null}
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
    const thumbnails = log.images
        .map((image) => image.thumbnailUrl || image.dataUrl)
        .filter((image): image is string => Boolean(image))
        .slice(0, 4);
    const title = generationPromptSummary(log);

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
                <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-stone-900">
                    {thumbnails.length ? (
                        <div className={`grid h-full w-full gap-px bg-stone-200 dark:bg-stone-800 ${thumbnails.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                            {thumbnails.map((image, index) => (
                                <DeferredImage key={`${log.id}-${index}`} src={image} alt={index === 0 ? title : ""} className="h-full w-full object-cover" fetchPriority="low" />
                            ))}
                        </div>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-400">
                            <ImagePlus className="size-7" />
                            <span className="text-xs">未留下画卷</span>
                        </div>
                    )}
                    <Tag className="absolute right-2 top-2 m-0" color={log.status === "成功" ? "success" : "error"}>
                        {log.status}
                    </Tag>
                </div>
                <div className="p-3">
                    <div className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{title}</div>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs text-stone-500">
                        <span className="truncate">{log.model || "默认模型"}</span>
                        <span className="shrink-0">
                            {log.successCount || log.imageCount} 张 · {formatDuration(log.durationMs)}
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

function generationUserPrompt(prompt: string) {
    const marker = "始终以“高清、准确、真实、专业”为最高优先级。";
    const markerIndex = prompt.lastIndexOf(marker);
    return (markerIndex >= 0 ? prompt.slice(markerIndex + marker.length) : prompt).trim();
}

function generationPromptSummary(log: GenerationLog) {
    const prompt = generationUserPrompt(log.prompt).replace(/\s+/g, " ").trim();
    return prompt || log.title || log.model || "未命名画卷";
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            const dataUrl = await resolveImageUrl(item.storageKey, item.dataUrl);
            return { ...item, dataUrl, thumbnailUrl: await resolveImageUrl(item.thumbnailKey, item.thumbnailUrl || dataUrl) };
        }),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
            thumbnailUrl: await resolveImageUrl(item.thumbnailKey, item.thumbnailUrl),
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
        thumbnails: images
            .map((image) => image.thumbnailUrl || image.dataUrl)
            .filter((image): image is string => Boolean(image)),
    };
}

async function prepareImageLogForServer(log: GenerationLog, expectedUserId: string): Promise<GenerationLog> {
    const references = await Promise.all(
        log.references.map(async (item) => {
            if (item.storageKey || !item.dataUrl) return item;
            const stored = await uploadImage(item.dataUrl, { expectedUserId, thumbnailMaxEdge: 1280 });
            return { ...item, dataUrl: stored.url, storageKey: stored.storageKey, thumbnailKey: stored.thumbnailKey, thumbnailUrl: stored.thumbnailUrl, type: stored.mimeType };
        }),
    );
    const images = await Promise.all(
        log.images.map(async (image) => {
            if (image.persisted === false || image.storageKey || !image.dataUrl) return image;
            const stored = await uploadImage(image.dataUrl, { outputFormat: log.config.imageOutputFormat, expectedUserId });
            return {
                ...image,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                thumbnailKey: stored.thumbnailKey,
                thumbnailUrl: stored.thumbnailUrl,
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
    const prompt = generationUserPrompt(job.prompt);
    const images: GeneratedImage[] = (job.result?.images || []).map((image) => ({
        id: image.id,
        dataUrl: image.dataUrl,
        durationMs: image.durationMs || job.result?.durationMs || 0,
        width: image.width || 0,
        height: image.height || 0,
        bytes: image.bytes || 0,
        mimeType: image.mimeType,
        serverJobId: job.id,
        persisted: image.persisted,
        expiresAt: image.expiresAt,
    }));
    const model = serverJobModelValue(job);
    const config: GenerationLogConfig = {
        model,
        imageModel: model,
        quality: job.quality || "",
        imageQuality: job.imageQuality || "auto",
        imageOutputFormat: job.imageOutputFormat || "auto",
        size: normalizeImageSizeSelection(job.size),
        count: String(job.count || images.length || 1),
        background: job.background || "",
    };
    return {
        id: `server-job:${job.id}`,
        createdAt: job.createdAt,
        updatedAt: job.finishedAt || job.createdAt,
        serverJobIds: [job.id],
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false }),
        model,
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
        if ([...(current.serverJobIds || [])].sort().join("|") !== [...(log.serverJobIds || [])].sort().join("|")) return true;
        const currentImages = current.images.map((image) => `${image.id}:${image.persisted === false ? "temporary" : image.dataUrl}`).join("|");
        const nextImages = log.images.map((image) => `${image.id}:${image.persisted === false ? "temporary" : image.dataUrl}`).join("|");
        return currentImages !== nextImages;
    });
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        imageQuality: log.config?.imageQuality || "auto",
        imageOutputFormat: log.config?.imageOutputFormat || "auto",
        size: normalizeImageSizeSelection(log.config?.size || log.size),
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
        background: log.config?.background || "",
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
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowLeft className="size-3" />}
                disabled={index <= 0}
                onClick={(event) => {
                    event.stopPropagation();
                    onMove(-1);
                }}
                aria-label="上移参考图"
            />
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={(event) => {
                    event.stopPropagation();
                    onMove(1);
                }}
                aria-label="下移参考图"
            />
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
        background: config.background,
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

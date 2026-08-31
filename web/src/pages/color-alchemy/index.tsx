import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { App, ConfigProvider, Drawer, Modal, Segmented, Slider, theme as antdTheme } from "antd";
import { Columns2, Download, ImagePlus, Images, Layers3, Save, SlidersHorizontal, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { ColorControlPanel } from "@/features/color-alchemy/color-control-panel";
import { ColorAlchemyToolbar } from "@/features/color-alchemy/color-alchemy-toolbar";
import { ColorPreviewStage } from "@/features/color-alchemy/color-preview-stage";
import { ColorSourcePanel, type ColorSourcePanelTab } from "@/features/color-alchemy/color-source-panel";
import { deriveBorrowedColorSettings, recommendColorSettings } from "@/features/color-alchemy/color-engine";
import { applyColorPreset } from "@/features/color-alchemy/presets";
import { analyzeColorSource, colorExportExtension, renderColorBlob, type ColorRenderOptions } from "@/features/color-alchemy/renderer";
import { normalizeColorSettings } from "@/features/color-alchemy/settings";
import { prepareColorAlchemyForUser, useColorAlchemyStore } from "@/features/color-alchemy/use-color-alchemy-store";
import type { AnalyzedColor, ColorAlchemySource, ColorExportFormat, ColorPreset, ColorSettings } from "@/features/color-alchemy/types";
import { deleteColorAlchemyDocument, fetchColorAlchemyDocuments, saveColorAlchemyDocument, type ColorAlchemyDocumentTombstone } from "@/services/color-alchemy-api";
import { lazyRoute } from "@/lib/lazy-route";
import { readCreativeImageTransfer } from "@/lib/creative-image-transfer";
import "@/features/color-alchemy/color-alchemy.css";

const SETTINGS_CLIPBOARD_KEY = "infinite-canvas:color-alchemy:clipboard";
const ColorSourceDialog = lazyRoute(() => import("@/features/color-alchemy/color-source-dialog").then(({ ColorSourceDialog: Component }) => ({ default: Component })));

export default function ColorAlchemyPage() {
    const { message } = App.useApp();
    const location = useLocation();
    const navigate = useNavigate();
    const userId = useUserStore((state) => state.user?.id || "");
    const hydrated = useColorAlchemyStore((state) => state.hydrated);
    const documents = useColorAlchemyStore((state) => state.documents);
    const activeDocumentId = useColorAlchemyStore((state) => state.activeDocumentId);
    const mergeDocuments = useColorAlchemyStore((state) => state.mergeDocuments);
    const removeDocuments = useColorAlchemyStore((state) => state.removeDocuments);
    const removeDocument = useColorAlchemyStore((state) => state.removeDocument);
    const openSource = useColorAlchemyStore((state) => state.openSource);
    const selectDocument = useColorAlchemyStore((state) => state.selectDocument);
    const setAnalysis = useColorAlchemyStore((state) => state.setAnalysis);
    const setReference = useColorAlchemyStore((state) => state.setReference);
    const replaceSettings = useColorAlchemyStore((state) => state.replaceSettings);
    const commitSettings = useColorAlchemyStore((state) => state.commitSettings);
    const undo = useColorAlchemyStore((state) => state.undo);
    const redo = useColorAlchemyStore((state) => state.redo);
    const reset = useColorAlchemyStore((state) => state.reset);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [sourceDialog, setSourceDialog] = useState<"assets" | "canvas" | null>(null);
    const [mobilePanel, setMobilePanel] = useState<"sources" | "controls" | null>(null);
    const [sourcePanelTab, setSourcePanelTab] = useState<ColorSourcePanelTab>("sources");
    const [originalPinned, setOriginalPinned] = useState(false);
    const [originalHeld, setOriginalHeld] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [returning, setReturning] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportFormat, setExportFormat] = useState<ColorExportFormat>("png");
    const [exportQuality, setExportQuality] = useState(92);
    const [pickedColor, setPickedColor] = useState<AnalyzedColor | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [cloudReadyUserId, setCloudReadyUserId] = useState("");
    const [syncTick, setSyncTick] = useState(0);
    const desktopLayout = useDesktopColorLayout();
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const syncedVersionsRef = useRef(new Map<string, string>());
    const syncTasksRef = useRef(new Map<string, Promise<void>>());
    const deletedDocumentIdsRef = useRef(new Map<string, string>());
    const syncRetryAfterRef = useRef(new Map<string, number>());
    const syncRetryTimersRef = useRef(new Map<string, number>());
    const exportAbortRef = useRef<AbortController | null>(null);
    const consumedImageTransferRef = useRef<string | null>(null);

    useEffect(() => prepareColorAlchemyForUser(userId), [userId]);

    useEffect(() => {
        const transfer = readCreativeImageTransfer(location.state);
        if (!hydrated || !transfer || consumedImageTransferRef.current === transfer.id) return;
        consumedImageTransferRef.current = transfer.id;
        openSource({
            key: transfer.storageKey || `image-workbench:${transfer.id}`,
            title: transfer.title,
            url: transfer.dataUrl,
            storageKey: transfer.storageKey,
            width: transfer.width,
            height: transfer.height,
            mimeType: transfer.mimeType,
        });
        message.success("已将丹青台图片载入灵彩");
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }, [hydrated, location.pathname, location.search, location.state, message, navigate, openSource]);

    useEffect(() => {
        if (!userId) setCloudReadyUserId("");
        syncedVersionsRef.current.clear();
        syncTasksRef.current.clear();
        deletedDocumentIdsRef.current.clear();
        syncRetryAfterRef.current.clear();
        for (const timer of syncRetryTimersRef.current.values()) window.clearTimeout(timer);
        syncRetryTimersRef.current.clear();
    }, [userId]);

    useEffect(
        () => () => {
            for (const timer of syncRetryTimersRef.current.values()) window.clearTimeout(timer);
            syncRetryTimersRef.current.clear();
        },
        [],
    );

    useEffect(() => {
        if (!PUBLIC_MODE || !userId || !hydrated || cloudReadyUserId === userId) return;
        let cancelled = false;
        void fetchColorAlchemyDocuments(userId)
            .then(({ items, deleted }) => {
                if (cancelled) return;
                mergeDocuments(items);
                for (const item of items) syncedVersionsRef.current.set(item.id, item.updatedAt);
                applyDeletedDocuments(deleted, removeDocuments, syncedVersionsRef, deletedDocumentIdsRef);
            })
            .catch((error) => {
                if (!cancelled) message.warning(`灵彩草稿暂未同步：${error instanceof Error ? error.message : "请稍后重试"}`);
            })
            .finally(() => {
                if (!cancelled) setCloudReadyUserId(userId);
            });
        return () => {
            cancelled = true;
        };
    }, [cloudReadyUserId, hydrated, mergeDocuments, message, userId]);

    useEffect(() => {
        if (!PUBLIC_MODE || !userId || !hydrated || cloudReadyUserId !== userId) return;
        const persistable = documents.filter(
            (item) =>
                Boolean(item.source.storageKey) &&
                !deletedDocumentIdsRef.current.has(item.id) &&
                syncedVersionsRef.current.get(item.id) !== item.updatedAt &&
                !syncTasksRef.current.has(item.id) &&
                (syncRetryAfterRef.current.get(item.id) || 0) <= Date.now(),
        );
        if (!persistable.length) return;
        const timer = window.setTimeout(() => {
            for (const item of persistable) {
                const syncedVersion = item.updatedAt;
                let task: Promise<void>;
                task = saveColorAlchemyDocument(item, userId)
                    .then(({ document: saved, deleted }) => {
                        if (deleted) {
                            applyDeletedDocuments([deleted], removeDocuments, syncedVersionsRef, deletedDocumentIdsRef);
                            return;
                        }
                        syncedVersionsRef.current.set(item.id, saved?.updatedAt || syncedVersion);
                        syncRetryAfterRef.current.delete(item.id);
                    })
                    .catch((error) => {
                        console.warn("color-alchemy document sync failed", error);
                        const retryAfter = Date.now() + 10_000;
                        syncRetryAfterRef.current.set(item.id, retryAfter);
                        const previousTimer = syncRetryTimersRef.current.get(item.id);
                        if (previousTimer) window.clearTimeout(previousTimer);
                        syncRetryTimersRef.current.set(
                            item.id,
                            window.setTimeout(() => {
                                syncRetryTimersRef.current.delete(item.id);
                                setSyncTick((value) => value + 1);
                            }, retryAfter - Date.now()),
                        );
                    })
                    .finally(() => {
                        if (syncTasksRef.current.get(item.id) !== task) return;
                        syncTasksRef.current.delete(item.id);
                        setSyncTick((value) => value + 1);
                    });
                syncTasksRef.current.set(item.id, task);
            }
        }, 800);
        return () => window.clearTimeout(timer);
    }, [cloudReadyUserId, documents, hydrated, removeDocuments, syncTick, userId]);

    const document = useMemo(() => documents.find((item) => item.id === activeDocumentId) || documents[0] || null, [activeDocumentId, documents]);
    const forceOriginal = originalPinned || originalHeld;
    const canUndo = Boolean(document && (document.historyIndex > 0 || JSON.stringify(document.settings) !== JSON.stringify(document.history[document.historyIndex])));
    const canRedo = Boolean(document && document.historyIndex < document.history.length - 1);

    useEffect(() => {
        setOriginalPinned(false);
        setOriginalHeld(false);
        setPickedColor(null);
    }, [document?.id, document?.source.key]);

    useEffect(() => {
        setSourcePanelTab("sources");
    }, [document?.id]);

    useEffect(() => {
        if (!document) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const editing = target instanceof HTMLElement && (target.matches("input, textarea, [contenteditable='true']") || Boolean(target.closest(".ant-modal, .ant-drawer")));
            if (editing || event.code !== "Space") return;
            event.preventDefault();
            setOriginalHeld(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setOriginalHeld(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [document]);

    const importFile = async (file: File) => {
        if (!file.type.startsWith("image/")) return message.warning("请选择图片文件");
        setUploading(true);
        const previewUrl = URL.createObjectURL(file);
        try {
            const image = await uploadImage(file, { previewUrl, createThumbnail: true });
            openSource({ key: image.storageKey, title: stripExtension(file.name) || "灵彩图片", url: image.url, storageKey: image.storageKey, width: image.width, height: image.height, mimeType: image.mimeType });
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            message.error(error instanceof Error ? error.message : "图片添加失败");
        } finally {
            setUploading(false);
        }
    };

    const applySettings = (settings: ColorSettings, commit = false) => {
        if (document) replaceSettings(document.id, settings, commit);
    };

    const applyPreset = (preset: ColorPreset) => {
        if (!document) return;
        replaceSettings(document.id, applyColorPreset(preset, 100), true);
        message.success(`已应用色彩秘卷：${preset.name}`);
    };

    const applyLut = (lutFile: string | null) => {
        if (!document) return;
        replaceSettings(document.id, normalizeColorSettings({ ...document.settings, lutId: lutFile, lutIntensity: 100, preset: null }), true);
        message.success(lutFile ? "胶片滤镜已应用" : "胶片滤镜已清除");
    };

    const applyAiRecommendation = () => {
        if (!document?.analysis) return;
        const result = recommendColorSettings(document.analysis, document.settings);
        replaceSettings(document.id, result.settings, true);
        message.success("灵彩优化完成");
    };

    const addReference = async (file: File) => {
        if (!document || !file.type.startsWith("image/")) return message.warning("请选择参考图片");
        const previewUrl = URL.createObjectURL(file);
        try {
            const image = await uploadImage(file, { previewUrl, createThumbnail: false });
            const source: ColorAlchemySource = { key: image.storageKey, title: stripExtension(file.name) || "借色参考", url: image.url, storageKey: image.storageKey, width: image.width, height: image.height, mimeType: image.mimeType };
            const analysis = await analyzeColorSource(source);
            setReference(document.id, { ...source, analysis });
            message.success("参考图片色彩已解析");
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            message.error(error instanceof Error ? error.message : "参考图片分析失败");
        }
    };

    const borrowColors = () => {
        if (!document?.analysis || !document.reference?.analysis) return;
        replaceSettings(document.id, deriveBorrowedColorSettings(document.analysis, document.reference.analysis, document.settings), true);
        message.success("已借取参考图的色彩关系，主体与构图保持不变");
    };

    const createRenderedImage = async (format: ColorExportFormat = "webp", quality = 0.92, fitUploadLimit = false, renderOptions?: ColorRenderOptions) => {
        if (!document) throw new Error("请先添加图片");
        const rendered = await renderColorBlob(document.source, document.settings, format, quality, undefined, renderOptions);
        return fitUploadLimit ? fitColorUploadBlob(document.source, document.settings, rendered) : { blob: rendered, compressed: false };
    };

    const saveToAssets = async () => {
        if (!document || saving) return;
        setSaving(true);
        try {
            const { blob, compressed } = await createRenderedImage("webp", 0.92, true);
            const image = await uploadImage(blob, { createThumbnail: true });
            addAsset({
                kind: "image",
                title: `${document.source.title} · 灵彩`,
                coverUrl: image.thumbnailUrl || image.url,
                tags: ["灵彩", "调色"],
                source: "灵彩",
                data: { dataUrl: image.url, storageKey: image.storageKey, thumbnailKey: image.thumbnailKey, thumbnailUrl: image.thumbnailUrl, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                metadata: { source: "color-alchemy", sourceKey: document.source.key, sourceStorageKey: document.source.storageKey, colorSettings: document.settings },
            });
            message.success(compressed ? "调色作品已压缩并入藏卷阁" : "调色作品已入藏卷阁");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败，请重试");
        } finally {
            setSaving(false);
        }
    };

    const exportImage = async () => {
        if (!document || exporting) return;
        const controller = new AbortController();
        exportAbortRef.current = controller;
        setExporting(true);
        setExportProgress(0);
        try {
            const { blob } = await createRenderedImage(exportFormat, exportQuality / 100, false, { signal: controller.signal, onProgress: ({ progress }) => setExportProgress(progress) });
            const { saveAs } = await import("file-saver");
            saveAs(blob, `${safeFileName(document.source.title)}-灵彩.${colorExportExtension(exportFormat)}`);
            setExportOpen(false);
            message.success("调色结果已导出");
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") message.info("已取消导出");
            else message.error(error instanceof Error ? error.message : "导出失败，请重试");
        } finally {
            exportAbortRef.current = null;
            setExporting(false);
            setExportProgress(0);
        }
    };

    const returnToCanvas = async () => {
        if (!document?.source.origin?.projectId || returning) return;
        const project = useCanvasStore.getState().openProject(document.source.origin.projectId);
        if (!project) return message.error("原画布已不存在");
        setReturning(true);
        try {
            const { blob, compressed } = await createRenderedImage("webp", 0.92, true);
            const image = await uploadImage(blob, { createThumbnail: true });
            const latestProject = useCanvasStore.getState().openProject(document.source.origin.projectId);
            if (!latestProject) throw new Error("原画布已不存在");
            const sourceNode = latestProject.nodes.find((node) => node.id === document.source.origin?.nodeId);
            const size = fitNodeSize(image.width, image.height, 640, 640);
            const baseNode = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, imageMetadata(image));
            const nextNode = {
                ...baseNode,
                title: `${document.source.title} · 灵彩`,
                width: size.width,
                height: size.height,
                position: sourceNode ? { x: sourceNode.position.x + sourceNode.width + 56, y: sourceNode.position.y } : { x: 120, y: 120 },
                metadata: { ...baseNode.metadata, colorSettings: document.settings, colorAlchemySourceKey: document.source.key },
            };
            useCanvasStore.getState().updateProject(latestProject.id, { nodes: [...latestProject.nodes, nextNode] });
            message.success(compressed ? "已压缩并生成新的灵彩节点，原图保持不变" : "已生成新的灵彩节点，原图保持不变");
            navigate(document.source.origin.route || `/canvas/${project.id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "返回画布失败");
        } finally {
            setReturning(false);
        }
    };

    const discardDocument = async (id: string) => {
        const discarded = documents.find((item) => item.id === id);
        if (!discarded) return;
        deletedDocumentIdsRef.current.set(id, new Date().toISOString());
        removeDocument(id);
        syncedVersionsRef.current.delete(id);
        if (!PUBLIC_MODE || !userId) return;
        try {
            await syncTasksRef.current.get(id);
            const { deleted } = await deleteColorAlchemyDocument(id, userId);
            deletedDocumentIdsRef.current.set(id, deleted.deletedAt);
        } catch (error) {
            deletedDocumentIdsRef.current.delete(id);
            mergeDocuments([discarded]);
            message.warning(`草稿尚未删除，已恢复到列表：${error instanceof Error ? error.message : "请稍后重试"}`);
        }
    };

    const copySettings = async () => {
        if (!document) return;
        const value = JSON.stringify(document.settings);
        window.localStorage.setItem(SETTINGS_CLIPBOARD_KEY, value);
        await navigator.clipboard?.writeText(value).catch(() => undefined);
        message.success("调色参数已复制");
    };

    const pasteSettings = async () => {
        if (!document) return;
        try {
            const clipboard = await navigator.clipboard?.readText().catch(() => "");
            const value = clipboard || window.localStorage.getItem(SETTINGS_CLIPBOARD_KEY) || "";
            replaceSettings(document.id, normalizeColorSettings(JSON.parse(value)), true);
            message.success("调色参数已粘贴");
        } catch {
            message.warning("剪贴板里没有可用的调色参数");
        }
    };

    if (!hydrated) return <div className="grid h-full place-items-center bg-[#101214] text-sm text-white/55">正在开启灵彩空间…</div>;

    return (
        <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm, token: { colorPrimary: "#d7b46a", borderRadius: 6, colorBgElevated: "#1b1d20", colorBorder: "rgba(255,255,255,.12)" } }}>
            <main className="color-alchemy-shell h-full min-h-0">
                <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void importFile(file);
                        event.currentTarget.value = "";
                    }}
                />
                {document ? (
                    <div className="relative flex h-full min-h-0 flex-col">
                        <ColorAlchemyToolbar
                            title={document.source.title}
                            canReturn={Boolean(document.source.origin?.projectId)}
                            returning={returning}
                            canUndo={canUndo}
                            canRedo={canRedo}
                            originalPinned={originalPinned}
                            saving={saving}
                            onReturn={() => void returnToCanvas()}
                            onUndo={() => undo(document.id)}
                            onRedo={() => redo(document.id)}
                            onCompareStart={() => setOriginalHeld(true)}
                            onCompareEnd={() => setOriginalHeld(false)}
                            onToggleOriginal={() => setOriginalPinned((value) => !value)}
                            onReset={() => reset(document.id)}
                            onCopy={() => void copySettings()}
                            onPaste={() => void pasteSettings()}
                            onSave={() => void saveToAssets()}
                            onExport={() => setExportOpen(true)}
                            onOpenSources={() => setMobilePanel("sources")}
                        />

                        <div className="grid min-h-0 flex-1 grid-cols-1 pb-[58px] lg:grid-cols-[216px_minmax(0,1fr)_336px] lg:pb-0 xl:grid-cols-[232px_minmax(0,1fr)_360px] 2xl:grid-cols-[240px_minmax(0,1fr)_368px]">
                            {desktopLayout ? (
                                <div className="min-h-0">
                                    <ColorSourcePanel
                                        document={document}
                                        documents={documents}
                                        onSelectDocument={selectDocument}
                                        onUpload={() => uploadInputRef.current?.click()}
                                        onOpenAssets={() => setSourceDialog("assets")}
                                        onOpenCanvas={() => setSourceDialog("canvas")}
                                        onSelectSource={openSource}
                                        onApplyPreset={applyPreset}
                                        onApplyLut={applyLut}
                                        onRemoveDocument={(id) => void discardDocument(id)}
                                        activeTab={sourcePanelTab}
                                        onTabChange={setSourcePanelTab}
                                    />
                                </div>
                            ) : null}
                            <ColorPreviewStage source={document.source} settings={document.settings} forceOriginal={forceOriginal} onAnalysis={(analysis) => setAnalysis(document.id, analysis)} onPickColor={setPickedColor} />
                            {desktopLayout ? (
                                <div className="min-h-0">
                                    <ColorControlPanel
                                        document={document}
                                        analyzing={!document.analysis}
                                        onSettingsChange={(settings) => applySettings(settings)}
                                        onCommit={() => commitSettings(document.id)}
                                        onApplyAi={applyAiRecommendation}
                                        onApplyPreset={applyPreset}
                                        onReferenceUpload={(file) => void addReference(file)}
                                        onBorrowColors={borrowColors}
                                        pickedColor={pickedColor}
                                    />
                                </div>
                            ) : null}
                        </div>
                        {!desktopLayout ? (
                            <MobileColorDock
                                saving={saving}
                                originalActive={forceOriginal}
                                onSources={() => setMobilePanel("sources")}
                                onCompareStart={() => setOriginalHeld(true)}
                                onCompareEnd={() => setOriginalHeld(false)}
                                onControls={() => setMobilePanel("controls")}
                                onSave={() => void saveToAssets()}
                                onExport={() => setExportOpen(true)}
                            />
                        ) : null}
                    </div>
                ) : (
                    <EmptyColorAlchemy
                        uploading={uploading}
                        dragActive={dragActive}
                        onUpload={() => uploadInputRef.current?.click()}
                        onAssets={() => setSourceDialog("assets")}
                        onCanvas={() => setSourceDialog("canvas")}
                        onDragActive={setDragActive}
                        onDrop={(file) => void importFile(file)}
                    />
                )}

                {sourceDialog ? (
                    <Suspense fallback={<DeferredToolLoading label="正在打开素材..." />}>
                        <ColorSourceDialog open initialTab={sourceDialog} onSelect={openSource} onClose={() => setSourceDialog(null)} />
                    </Suspense>
                ) : null}
                {document && !desktopLayout ? (
                    <>
                        <Drawer
                            title="灵彩素材与工具"
                            placement="bottom"
                            size="min(86dvh, 760px)"
                            rootClassName="color-alchemy-mobile-drawer"
                            open={mobilePanel === "sources"}
                            onClose={() => setMobilePanel(null)}
                            styles={{ body: { padding: 0, overflow: "hidden" } }}
                        >
                            <ColorSourcePanel
                                document={document}
                                documents={documents}
                                onSelectDocument={(id) => {
                                    selectDocument(id);
                                    setMobilePanel(null);
                                }}
                                onUpload={() => uploadInputRef.current?.click()}
                                onOpenAssets={() => setSourceDialog("assets")}
                                onOpenCanvas={() => setSourceDialog("canvas")}
                                onSelectSource={(source) => {
                                    openSource(source);
                                    setMobilePanel(null);
                                }}
                                onApplyPreset={applyPreset}
                                onApplyLut={applyLut}
                                onRemoveDocument={(id) => void discardDocument(id)}
                                activeTab={sourcePanelTab}
                                onTabChange={setSourcePanelTab}
                            />
                        </Drawer>
                        <Drawer
                            title="灵彩设计"
                            placement="bottom"
                            size="min(92dvh, 820px)"
                            rootClassName="color-alchemy-mobile-drawer"
                            open={mobilePanel === "controls"}
                            onClose={() => setMobilePanel(null)}
                            styles={{ body: { padding: 0, overflow: "hidden" } }}
                        >
                            <ColorControlPanel
                                document={document}
                                analyzing={!document.analysis}
                                onSettingsChange={(settings) => applySettings(settings)}
                                onCommit={() => commitSettings(document.id)}
                                onApplyAi={applyAiRecommendation}
                                onApplyPreset={applyPreset}
                                onReferenceUpload={(file) => void addReference(file)}
                                onBorrowColors={borrowColors}
                                pickedColor={pickedColor}
                            />
                        </Drawer>
                    </>
                ) : null}
                <Modal
                    title="导出调色作品"
                    open={exportOpen}
                    okText={exporting ? "导出中…" : "导出"}
                    cancelText={exporting ? "取消导出" : "取消"}
                    confirmLoading={exporting}
                    onOk={() => void exportImage()}
                    onCancel={() => {
                        if (exporting) exportAbortRef.current?.abort();
                        else setExportOpen(false);
                    }}
                >
                    <div className="space-y-6 py-2">
                        {exporting ? (
                            <div className="rounded-md border border-[#d7b46a]/20 bg-[#d7b46a]/6 p-3">
                                <div className="flex items-center justify-between gap-3 text-xs text-white/62">
                                    <span>{exportProgress >= 0.9 ? "正在编码文件…" : exportProgress >= 0.12 ? "正在处理像素…" : "正在准备图片…"}</span>
                                    <span>{Math.round(exportProgress * 100)}%</span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                    <div className="h-full w-full origin-left rounded-full bg-[#d7b46a] transition-transform duration-150" style={{ transform: `scaleX(${Math.max(0.04, exportProgress)})` }} />
                                </div>
                                <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white" onClick={() => exportAbortRef.current?.abort()}>
                                    <X className="size-3.5" />
                                    取消导出
                                </button>
                            </div>
                        ) : null}
                        <div>
                            <div className="mb-2 text-sm text-white/65">格式</div>
                            <Segmented
                                block
                                value={exportFormat}
                                onChange={(value) => setExportFormat(value as ColorExportFormat)}
                                options={[
                                    { label: "PNG", value: "png" },
                                    { label: "JPG", value: "jpeg" },
                                    { label: "WEBP", value: "webp" },
                                ]}
                            />
                        </div>
                        {exportFormat !== "png" ? (
                            <div>
                                <div className="mb-2 flex justify-between text-sm text-white/65">
                                    <span>质量</span>
                                    <span>{exportQuality}%</span>
                                </div>
                                <Slider min={40} max={100} value={exportQuality} onChange={setExportQuality} />
                            </div>
                        ) : null}
                    </div>
                </Modal>
            </main>
        </ConfigProvider>
    );
}

function DeferredToolLoading({ label }: { label: string }) {
    return (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/20 backdrop-blur-[1px]" aria-live="polite">
            <span className="rounded border border-white/10 bg-[#17181d] px-4 py-2 text-sm text-white/70 shadow-xl">{label}</span>
        </div>
    );
}

function EmptyColorAlchemy({
    uploading,
    dragActive,
    onUpload,
    onAssets,
    onCanvas,
    onDragActive,
    onDrop,
}: {
    uploading: boolean;
    dragActive: boolean;
    onUpload: () => void;
    onAssets: () => void;
    onCanvas: () => void;
    onDragActive: (value: boolean) => void;
    onDrop: (file: File) => void;
}) {
    return (
        <div
            className="color-alchemy-empty relative flex h-full items-center justify-center overflow-hidden px-5 py-8"
            onDragEnter={(event) => {
                event.preventDefault();
                onDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
                if (event.currentTarget === event.target) onDragActive(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                onDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onDrop(file);
            }}
        >
            <section className={`color-empty-dropzone relative ${dragActive ? "is-dragging" : ""}`}>
                <div className="mx-auto mb-6 grid size-12 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-[#d7b46a]">
                    <ImagePlus className="size-5" />
                </div>
                <h1 className="text-2xl font-semibold text-[#f2eee5]">选择一张图片，开始灵彩</h1>
                <p className="mt-2 text-sm text-white/40">从本地、藏卷阁或画布载入。</p>
                <div className="mt-7 flex flex-wrap justify-center gap-2">
                    <button type="button" className="flex h-10 items-center gap-2 rounded bg-[#d7b46a] px-4 text-sm font-semibold text-[#18140d] transition hover:bg-[#e2c37d]" disabled={uploading} onClick={onUpload}>
                        <ImagePlus className="size-4" />
                        {uploading ? "正在载入" : "选择图片"}
                    </button>
                    <button type="button" className="flex h-10 items-center gap-2 rounded border border-white/10 px-4 text-sm text-white/62 transition hover:bg-white/5 hover:text-white" onClick={onAssets}>
                        <Images className="size-4" />
                        藏卷阁
                    </button>
                    <button type="button" className="flex h-10 items-center gap-2 rounded border border-white/10 px-4 text-sm text-white/62 transition hover:bg-white/5 hover:text-white" onClick={onCanvas}>
                        <Layers3 className="size-4" />
                        无限画布
                    </button>
                </div>
                <div className="mt-6 text-[11px] text-white/24">也可将图片拖入此处</div>
            </section>
        </div>
    );
}

function MobileColorDock({
    saving,
    originalActive,
    onSources,
    onCompareStart,
    onCompareEnd,
    onControls,
    onSave,
    onExport,
}: {
    saving: boolean;
    originalActive: boolean;
    onSources: () => void;
    onCompareStart: () => void;
    onCompareEnd: () => void;
    onControls: () => void;
    onSave: () => void;
    onExport: () => void;
}) {
    const endCompare = (target?: HTMLElement, pointerId?: number) => {
        if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        onCompareEnd();
    };

    return (
        <nav className="color-mobile-dock lg:hidden" aria-label="灵彩快捷操作">
            <button type="button" onClick={onSources}>
                <Images className="size-4" />
                素材
            </button>
            <button
                type="button"
                className={originalActive ? "is-primary" : ""}
                title="按住查看原图"
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    onCompareStart();
                }}
                onPointerUp={(event) => endCompare(event.currentTarget, event.pointerId)}
                onPointerCancel={(event) => endCompare(event.currentTarget, event.pointerId)}
                onLostPointerCapture={onCompareEnd}
            >
                <Columns2 className="size-4" />
                对比
            </button>
            <button type="button" onClick={onControls}>
                <SlidersHorizontal className="size-4" />
                调整
            </button>
            <button type="button" disabled={saving} onClick={onSave}>
                <Save className="size-4" />
                {saving ? "保存中" : "保存"}
            </button>
            <button type="button" className="is-primary" onClick={onExport}>
                <Download className="size-4" />
                导出
            </button>
        </nav>
    );
}

function useDesktopColorLayout() {
    const [desktop, setDesktop] = useState(() => (typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches));

    useEffect(() => {
        const query = window.matchMedia("(min-width: 1024px)");
        const update = () => setDesktop(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    return desktop;
}

function stripExtension(name: string) {
    return name.replace(/\.[^.]+$/, "").trim();
}

function safeFileName(name: string) {
    return (name || "color-alchemy").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function applyDeletedDocuments(deleted: ColorAlchemyDocumentTombstone[], removeDocuments: (ids: string[]) => void, syncedVersions: React.MutableRefObject<Map<string, string>>, locallyDeleted: React.MutableRefObject<Map<string, string>>) {
    const ids = deleted.map((item) => item.id);
    if (!ids.length) return;
    for (const item of deleted) {
        syncedVersions.current.delete(item.id);
        locallyDeleted.current.set(item.id, item.deletedAt);
    }
    removeDocuments(ids);
}

async function fitColorUploadBlob(source: ColorAlchemySource, settings: ColorSettings, initial: Blob) {
    const maxBytes = 15 * 1024 * 1024;
    if (initial.size <= maxBytes) return { blob: initial, compressed: false };
    for (const maxEdge of [9_600, 7_200, 5_400, 4_000]) {
        const candidate = await renderColorBlob(source, settings, "webp", 0.86, maxEdge);
        if (candidate.size <= maxBytes) return { blob: candidate, compressed: true };
    }
    throw new Error("调色结果过大，已尝试压缩仍超过 16 MB，请先导出原尺寸或使用更小的图片");
}

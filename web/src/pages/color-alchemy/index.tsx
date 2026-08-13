import { useEffect, useMemo, useRef, useState } from "react";
import { App, ConfigProvider, Drawer, Modal, Segmented, Slider, Tooltip, theme as antdTheme } from "antd";
import { ArrowLeft, ClipboardCopy, ClipboardPaste, Download, FileImage, ImagePlus, Images, Layers3, PanelLeft, PanelRight, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { saveAs } from "file-saver";
import { useNavigate } from "react-router-dom";

import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { ColorControlPanel } from "@/features/color-alchemy/color-control-panel";
import { ColorPreviewStage } from "@/features/color-alchemy/color-preview-stage";
import { ColorSourceDialog } from "@/features/color-alchemy/color-source-dialog";
import { ColorSourcePanel } from "@/features/color-alchemy/color-source-panel";
import { deriveBorrowedColorSettings, recommendColorSettings } from "@/features/color-alchemy/color-engine";
import { applyColorPreset } from "@/features/color-alchemy/presets";
import { analyzeColorSource, colorExportExtension, renderColorBlob } from "@/features/color-alchemy/renderer";
import { normalizeColorSettings } from "@/features/color-alchemy/settings";
import { prepareColorAlchemyForUser, useColorAlchemyStore } from "@/features/color-alchemy/use-color-alchemy-store";
import type { ColorAlchemySource, ColorExportFormat, ColorPreset, ColorSettings } from "@/features/color-alchemy/types";
import { deleteColorAlchemyDocument, fetchColorAlchemyDocuments, saveColorAlchemyDocument, type ColorAlchemyDocumentTombstone } from "@/services/color-alchemy-api";

const SETTINGS_CLIPBOARD_KEY = "infinite-canvas:color-alchemy:clipboard";

export default function ColorAlchemyPage() {
    const { message } = App.useApp();
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
    const [originalPinned, setOriginalPinned] = useState(false);
    const [originalHeld, setOriginalHeld] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [returning, setReturning] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportFormat, setExportFormat] = useState<ColorExportFormat>("png");
    const [exportQuality, setExportQuality] = useState(92);
    const [dragActive, setDragActive] = useState(false);
    const [cloudReadyUserId, setCloudReadyUserId] = useState("");
    const [syncTick, setSyncTick] = useState(0);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const syncedVersionsRef = useRef(new Map<string, string>());
    const syncTasksRef = useRef(new Map<string, Promise<void>>());
    const deletedDocumentIdsRef = useRef(new Map<string, string>());
    const syncRetryAfterRef = useRef(new Map<string, number>());
    const syncRetryTimersRef = useRef(new Map<string, number>());

    useEffect(() => prepareColorAlchemyForUser(userId), [userId]);

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
        message.success(`已展开秘卷：${preset.name}`);
    };

    const applyAiRecommendation = () => {
        if (!document?.analysis) return;
        const result = recommendColorSettings(document.analysis, document.settings);
        replaceSettings(document.id, result.settings, true);
        message.success(result.notes.length ? `推荐方案已应用：${result.notes.join("、")}` : "推荐方案已应用");
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

    const createRenderedImage = async (format: ColorExportFormat = "webp", quality = 0.92, fitUploadLimit = false) => {
        if (!document) throw new Error("请先添加图片");
        const rendered = await renderColorBlob(document.source, document.settings, format, quality);
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
        setExporting(true);
        try {
            const { blob } = await createRenderedImage(exportFormat, exportQuality / 100);
            saveAs(blob, `${safeFileName(document.source.title)}-灵彩.${colorExportExtension(exportFormat)}`);
            setExportOpen(false);
            message.success("调色结果已导出");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败，请重试");
        } finally {
            setExporting(false);
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
            <main className="h-full min-h-0 bg-[#101214] text-[#eeeae0]">
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
                    <div className="flex h-full min-h-0 flex-col">
                        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[#141619]/95 px-3 backdrop-blur-xl lg:px-4">
                            <div className="flex min-w-0 items-center gap-2">
                                <Tooltip title="素材与秘卷">
                                    <button type="button" className="grid size-8 place-items-center rounded text-white/55 hover:bg-white/8 hover:text-white lg:hidden" onClick={() => setMobilePanel("sources")}>
                                        <PanelLeft className="size-4" />
                                    </button>
                                </Tooltip>
                                <div className="hidden min-w-0 min-[430px]:block">
                                    <div className="flex items-baseline gap-2">
                                        <h1 className="text-sm font-semibold tracking-[0.1em]">灵彩</h1>
                                        <span className="hidden text-[10px] tracking-[0.15em] text-white/28 sm:inline">COLOR ALCHEMY</span>
                                    </div>
                                    <div className="max-w-48 truncate text-[10px] text-white/38 sm:max-w-72">{document.source.title}</div>
                                </div>
                                {document.source.origin?.projectId ? (
                                    <Tooltip title="返回画布">
                                        <button
                                            type="button"
                                            className="ml-1 flex size-8 items-center justify-center gap-1.5 rounded text-xs text-white/55 transition hover:bg-white/8 hover:text-white md:w-auto md:px-2"
                                            onClick={() => void returnToCanvas()}
                                            disabled={returning}
                                            aria-label="返回画布"
                                        >
                                            <ArrowLeft className="size-3.5" />
                                            <span className="hidden md:inline">{returning ? "正在返回" : "返回画布"}</span>
                                        </button>
                                    </Tooltip>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-0.5">
                                <TopTool title="撤销" icon={<Undo2 className="size-4" />} disabled={!canUndo} onClick={() => document && undo(document.id)} />
                                <TopTool title="重做" icon={<Redo2 className="size-4" />} disabled={!canRedo} onClick={() => document && redo(document.id)} />
                                <TopTool title="原图" icon={<FileImage className="size-4" />} active={originalPinned} onClick={() => setOriginalPinned((value) => !value)} />
                                <TopTool title="恢复原图" icon={<RotateCcw className="size-4" />} onClick={() => reset(document.id)} />
                                <span className="mx-1 h-5 w-px bg-white/8" />
                                <span className="hidden md:contents">
                                    <TopTool title="复制调色参数" icon={<ClipboardCopy className="size-4" />} onClick={() => void copySettings()} />
                                    <TopTool title="粘贴调色参数" icon={<ClipboardPaste className="size-4" />} onClick={() => void pasteSettings()} />
                                </span>
                                <button
                                    type="button"
                                    className="ml-1 flex size-8 items-center justify-center gap-1.5 rounded text-xs font-medium text-white/72 transition hover:bg-white/8 hover:text-white sm:w-auto sm:px-2"
                                    disabled={saving}
                                    onClick={() => void saveToAssets()}
                                    aria-label={saving ? "正在保存入藏卷阁" : "保存入藏卷阁"}
                                    title={saving ? "正在保存入藏卷阁" : "保存入藏卷阁"}
                                >
                                    <Save className="size-3.5" />
                                    <span className="hidden sm:inline">{saving ? "保存中" : "保存"}</span>
                                </button>
                                <button type="button" className="ml-1 flex h-8 items-center gap-1.5 rounded bg-[#d7b46a] px-2.5 text-xs font-semibold text-[#18140d] transition hover:bg-[#e5c783]" onClick={() => setExportOpen(true)}>
                                    <Download className="size-3.5" />
                                    <span className="hidden sm:inline">导出</span>
                                </button>
                                <Tooltip title="专业调色">
                                    <button type="button" className="ml-1 grid size-8 place-items-center rounded text-white/55 hover:bg-white/8 hover:text-white lg:hidden" onClick={() => setMobilePanel("controls")}>
                                        <PanelRight className="size-4" />
                                    </button>
                                </Tooltip>
                            </div>
                        </header>

                        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[238px_minmax(0,1fr)_326px] xl:grid-cols-[252px_minmax(0,1fr)_350px]">
                            <div className="hidden min-h-0 lg:block">
                                <ColorSourcePanel
                                    document={document}
                                    documents={documents}
                                    onSelectDocument={selectDocument}
                                    onUpload={() => uploadInputRef.current?.click()}
                                    onOpenAssets={() => setSourceDialog("assets")}
                                    onOpenCanvas={() => setSourceDialog("canvas")}
                                    onSelectSource={openSource}
                                    onApplyPreset={applyPreset}
                                    onRemoveDocument={(id) => void discardDocument(id)}
                                />
                            </div>
                            <ColorPreviewStage source={document.source} settings={document.settings} forceOriginal={forceOriginal} onAnalysis={(analysis) => setAnalysis(document.id, analysis)} />
                            <div className="hidden min-h-0 lg:block">
                                <ColorControlPanel
                                    document={document}
                                    analyzing={!document.analysis}
                                    onSettingsChange={(settings) => applySettings(settings)}
                                    onCommit={() => commitSettings(document.id)}
                                    onApplyAi={applyAiRecommendation}
                                    onReferenceUpload={(file) => void addReference(file)}
                                    onBorrowColors={borrowColors}
                                />
                            </div>
                        </div>
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

                <ColorSourceDialog open={Boolean(sourceDialog)} initialTab={sourceDialog || "assets"} onSelect={openSource} onClose={() => setSourceDialog(null)} />
                {document ? (
                    <>
                        <Drawer title="素材与色彩秘卷" placement="left" size={290} open={mobilePanel === "sources"} onClose={() => setMobilePanel(null)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
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
                                onRemoveDocument={(id) => void discardDocument(id)}
                            />
                        </Drawer>
                        <Drawer title="专业调色" placement="right" size="min(340px, calc(100vw - 12px))" open={mobilePanel === "controls"} onClose={() => setMobilePanel(null)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                            <ColorControlPanel
                                document={document}
                                analyzing={!document.analysis}
                                onSettingsChange={(settings) => applySettings(settings)}
                                onCommit={() => commitSettings(document.id)}
                                onApplyAi={applyAiRecommendation}
                                onReferenceUpload={(file) => void addReference(file)}
                                onBorrowColors={borrowColors}
                            />
                        </Drawer>
                    </>
                ) : null}
                <Modal title="导出调色作品" open={exportOpen} okText={exporting ? "导出中…" : "导出"} cancelText="取消" confirmLoading={exporting} onOk={() => void exportImage()} onCancel={() => setExportOpen(false)}>
                    <div className="space-y-6 py-2">
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
            className="relative flex h-full items-center justify-center overflow-hidden bg-[#101214] px-5 py-8"
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
            <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: "url('/images/ref/nebula-vortex.webp')" }} />
            <div className="absolute inset-0 bg-[#101214]/72" />
            <section className={`relative w-full max-w-4xl border border-white/10 bg-black/18 px-6 py-14 text-center backdrop-blur-xl transition sm:px-12 sm:py-20 ${dragActive ? "border-[#d7b46a]/70 bg-[#d7b46a]/8" : ""}`}>
                <div className="mx-auto mb-7 grid size-14 place-items-center rounded-md border border-white/12 bg-white/5 text-[#dfbd78]">
                    <ImagePlus className="size-6" />
                </div>
                <h1 className="text-2xl font-semibold tracking-normal text-[#f2eee5] sm:text-3xl">让色彩重新定义你的画面</h1>
                <p className="mt-3 text-sm text-white/42">上传一张图片，让灵感从色彩开始。</p>
                <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                    <button type="button" className="flex h-10 items-center gap-2 rounded bg-[#d7b46a] px-4 text-sm font-semibold text-[#18140d] transition hover:bg-[#e5c783]" disabled={uploading} onClick={onUpload}>
                        <ImagePlus className="size-4" />
                        {uploading ? "正在添加" : "添加图片"}
                    </button>
                    <button type="button" className="flex h-10 items-center gap-2 rounded border border-white/12 bg-white/5 px-4 text-sm text-white/68 transition hover:bg-white/9 hover:text-white" onClick={onAssets}>
                        <Images className="size-4" />
                        从作品库选择
                    </button>
                    <button type="button" className="flex h-10 items-center gap-2 rounded border border-white/12 bg-white/5 px-4 text-sm text-white/68 transition hover:bg-white/9 hover:text-white" onClick={onCanvas}>
                        <Layers3 className="size-4" />
                        从画布导入
                    </button>
                </div>
                <div className="mt-7 text-[11px] tracking-[0.12em] text-white/25">也可将图片拖入此处</div>
            </section>
        </div>
    );
}

function TopTool({ title, icon, disabled, active, onClick }: { title: string; icon: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void }) {
    return (
        <Tooltip title={title}>
            <button
                type="button"
                disabled={disabled}
                className={`grid size-8 place-items-center rounded transition ${active ? "bg-white/12 text-white" : "text-white/52 hover:bg-white/8 hover:text-white"} disabled:cursor-not-allowed disabled:opacity-22`}
                onClick={onClick}
                aria-label={title}
            >
                {icon}
            </button>
        </Tooltip>
    );
}

function stripExtension(name: string) {
    return name.replace(/\.[^.]+$/, "").trim();
}

function safeFileName(name: string) {
    return (name || "color-alchemy").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function applyDeletedDocuments(
    deleted: ColorAlchemyDocumentTombstone[],
    removeDocuments: (ids: string[]) => void,
    syncedVersions: React.MutableRefObject<Map<string, string>>,
    locallyDeleted: React.MutableRefObject<Map<string, string>>,
) {
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

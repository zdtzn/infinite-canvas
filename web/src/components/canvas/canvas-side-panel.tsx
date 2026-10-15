import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { App, Empty, Input, Popconfirm, Select, Tag } from "antd";
import { Check, ChevronRight, Download, Eye, FileText, Image as ImageIcon, LayoutGrid, ListChecks, Music2, Plus, Rows3, Search, Settings2, Square, Trash2, Type, Video } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { DeferredImage } from "@/components/ui/deferred-image";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { assetSaveMessage, type AssetSyncStatus } from "@/stores/asset-sync-queue";
import { useUserStore } from "@/stores/use-user-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, persistCanvasSidePanelWidth, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";
import { CanvasPromptList } from "./canvas-prompt-list";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            persistCanvasSidePanelWidth(nextWidth);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="absolute inset-y-0 left-0 z-[60] flex h-full shrink-0 md:relative"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-5 px-4 pt-3.5">
                    <TabButton label="图层" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                    <TabButton label="藏卷阁" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                    <TabButton label="提示词" active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {tab === "canvas" ? (
                        <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                    ) : tab === "assets" ? (
                        <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                    ) : (
                        <CanvasPromptList onInsert={onInsertAsset} theme={theme} />
                    )}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整左侧面板宽度" />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// 画布 Tab —— 列出节点,点击居中放大并选中
// ---------------------------------------------------------------------------

const NODE_FILTER_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: CanvasNodeType.Image },
    { label: "视频", value: CanvasNodeType.Video },
    { label: "文本", value: CanvasNodeType.Text },
    { label: "音频", value: CanvasNodeType.Audio },
    { label: "配置", value: CanvasNodeType.Config },
    { label: "分组", value: CanvasNodeType.Group },
];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

type NodeHoverPreview = { nodeId: string; left: number; top: number; width: number; height: number };

export function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const nodeViewMode = useCanvasSidePanelStore((state) => state.nodeViewMode);
    const setNodeViewMode = useCanvasSidePanelStore((state) => state.setNodeViewMode);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const [preview, setPreview] = useState<NodeHoverPreview | null>(null);
    const reducedMotion = useReducedMotion();
    const panelRef = useRef<HTMLDivElement>(null);
    const previewTimerRef = useRef<number | null>(null);
    const focusTimerRef = useRef<number | null>(null);

    const cancelPreviewTimer = useCallback(() => {
        if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
    }, []);
    const clearPreview = useCallback(() => {
        cancelPreviewTimer();
        setPreview(null);
    }, [cancelPreviewTimer]);
    const cancelFocusTimer = useCallback(() => {
        if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
    }, []);

    useEffect(() => {
        clearPreview();
        cancelFocusTimer();
        return () => {
            cancelPreviewTimer();
            cancelFocusTimer();
        };
    }, [panelOpen, keyword, typeFilter, nodeViewMode, selectMode, clearPreview, cancelPreviewTimer, cancelFocusTimer]);

    useEffect(() => {
        window.addEventListener("resize", clearPreview);
        return () => window.removeEventListener("resize", clearPreview);
    }, [clearPreview]);

    const showPreview = (node: CanvasNodeData) => {
        cancelPreviewTimer();
        if (selectMode || !panelOpen || !node.metadata?.content || ![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType)) {
            setPreview(null);
            return;
        }
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(480, window.innerWidth - rect.right - 24);
        if (width < 160 || window.innerHeight < 240) {
            setPreview(null);
            return;
        }
        const height = Math.min(560, window.innerHeight - 32);
        const position = { nodeId: node.id, left: rect.right + 12, top: Math.max(16, (window.innerHeight - height) / 2), width, height };
        previewTimerRef.current = window.setTimeout(() => {
            previewTimerRef.current = null;
            setPreview(position);
        }, 160);
    };
    const hidePreview = () => {
        cancelPreviewTimer();
        previewTimerRef.current = window.setTimeout(() => {
            previewTimerRef.current = null;
            setPreview(null);
        }, 120);
    };
    const activateNode = (node: CanvasNodeData) => {
        cancelFocusTimer();
        clearPreview();
        if (selectMode) {
            toggleChecked(node.id);
        } else if (preview?.nodeId === node.id) {
            focusTimerRef.current = window.setTimeout(() => {
                focusTimerRef.current = null;
                onFocusNode(node.id);
            }, 180);
        } else {
            onFocusNode(node.id);
        }
    };

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);
    const previewNode = panelOpen && !selectMode ? filtered.find((node) => node.id === preview?.nodeId) : undefined;

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading("正在导出选中元素…", 0);
        try {
            await exportCanvasNodes(targets, `画布元素-${targets.length}个`);
            message.success(`已导出 ${targets.length} 个元素`);
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error("导出失败，请重试");
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div ref={panelRef} className="flex h-full flex-col" onMouseLeave={hidePreview} onKeyDown={(event) => { if (event.key === "Escape") clearPreview(); }}>
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="min-w-0 truncate text-xs font-medium opacity-60">图层 / 节点</span>
                {filtered.length ? <span className="shrink-0 text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? "取消" : "选择"}
                </button>
                <button
                    type="button"
                    onClick={() => setNodeViewMode(nodeViewMode === "grid" ? "list" : "grid")}
                    className="grid size-7 shrink-0 place-items-center rounded-md opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    title={nodeViewMode === "grid" ? "切换为列表" : "切换为网格"}
                    aria-label={nodeViewMode === "grid" ? "切换为列表" : "切换为网格"}
                    aria-pressed={nodeViewMode === "grid"}
                >
                    {nodeViewMode === "grid" ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                </button>
            </div>
            <div className="flex items-center gap-1 px-3 pb-2.5">
                <Input size="small" className="min-w-0 flex-1" allowClear prefix={<Search className="size-3.5" style={{ color: theme.node.faint }} />} placeholder="搜索节点" aria-label="搜索节点" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20 shrink-0" aria-label="筛选节点类型" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS} />}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" onScroll={clearPreview}>
                {filtered.length ? (
                    <div className={nodeViewMode === "grid" ? "grid gap-2 px-1 [grid-template-columns:repeat(auto-fill,minmax(88px,1fr))]" : "space-y-1.5"}>
                        {filtered.map((node) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const isChecked = checked.has(node.id);
                            const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                            return (
                                <div
                                    key={node.id}
                                    className={cn("group relative flex min-w-0 rounded-lg transition", nodeViewMode === "grid" ? "flex-col p-1" : "w-full items-center", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
                                    style={active ? { background: theme.toolbar.activeBg } : undefined}
                                    onMouseEnter={() => showPreview(node)}
                                    onMouseLeave={hidePreview}
                                >
                                    <button
                                        type="button"
                                        onClick={() => activateNode(node)}
                                        onFocus={() => showPreview(node)}
                                        onBlur={hidePreview}
                                        className={cn("flex min-w-0 flex-1 text-left", nodeViewMode === "grid" ? "w-full flex-col" : "items-center gap-3 px-2 py-2")}
                                        title={selectMode ? undefined : "定位到节点"}
                                        aria-pressed={active}
                                    >
                                        {selectMode ? <span className={nodeViewMode === "grid" ? "absolute left-2 top-2 z-10" : undefined}><CheckMark checked={isChecked} theme={theme} /></span> : null}
                                        <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-md", nodeViewMode === "grid" ? "aspect-square w-full" : "size-10")}>
                                            {isImage ? <DeferredImage src={node.metadata!.thumbnailUrl || node.metadata!.content!} alt={node.title} className="size-full object-cover" fetchPriority="low" /> : <Icon className="size-5 opacity-60" />}
                                        </span>
                                        <span className={cn("min-w-0", nodeViewMode === "grid" ? "mt-1 w-full pr-7" : "flex-1 space-y-0.5")}>
                                            <span className={cn("block truncate font-medium leading-snug", nodeViewMode === "grid" ? "text-xs" : "text-sm")}>{node.title || getNodeDefinition(node.type)?.title || "未命名节点"}</span>
                                            {nodeViewMode === "list" ? <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span> : null}
                                        </span>
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className={cn("size-1.5 shrink-0 rounded-full", nodeViewMode === "grid" && "absolute right-2 top-2")} style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                    {selectMode || !isImage ? null : (
                                        <button
                                            type="button"
                                            onClick={() => { cancelFocusTimer(); clearPreview(); onPreviewNode(node.id); }}
                                            className={cn("grid size-7 shrink-0 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10", nodeViewMode === "grid" ? "absolute bottom-0 right-0" : "mr-1.5")}
                                            aria-label="放大预览"
                                            title="放大预览"
                                        >
                                            <Eye className="size-3.5" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">画布暂无节点</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {allChecked ? "取消全选" : "全选"}
                    </button>
                    <span className="text-xs opacity-45">已选 {checked.size}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        导出选中
                    </button>
                </div>
            ) : null}
            {typeof document !== "undefined" ? createPortal(
                <AnimatePresence>
                    {preview && previewNode ? (
                        <motion.div
                            key={previewNode.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: reducedMotion ? 0 : 0.12 }}
                            className="fixed z-[70] flex flex-col gap-3 overflow-hidden rounded-lg border p-3"
                            style={{ left: preview.left, top: preview.top, width: preview.width, maxHeight: preview.height, background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                            onMouseEnter={cancelPreviewTimer}
                            onMouseLeave={hidePreview}
                            onFocusCapture={cancelPreviewTimer}
                            onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hidePreview(); }}
                            data-canvas-no-zoom
                            aria-label={`${previewNode.title || "节点"}详情预览`}
                        >
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{previewNode.title || "未命名节点"}</div>
                                <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>{getNodeDefinition(previewNode.type)?.title || previewNode.type}</div>
                            </div>
                            {previewNode.type === CanvasNodeType.Image ? <DeferredImage src={previewNode.metadata!.thumbnailUrl || previewNode.metadata!.content!} alt={previewNode.title} className="w-full min-h-0 object-contain" style={{ maxHeight: preview.height - 150 }} fetchPriority="low" /> : null}
                            {previewNode.type === CanvasNodeType.Video ? <video src={previewNode.metadata!.content} controls playsInline preload="metadata" className="w-full min-h-0 object-contain" style={{ maxHeight: preview.height - 150 }} aria-label={previewNode.title || "视频预览"} /> : null}
                            {previewNode.type === CanvasNodeType.Audio ? <audio src={previewNode.metadata!.content} controls preload="metadata" className="w-full" aria-label={previewNode.title || "音频预览"} /> : null}
                            {previewNode.type === CanvasNodeType.Text ? <div className="min-h-0 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{previewNode.metadata!.content}</div> : null}
                            {previewNode.type !== CanvasNodeType.Text && previewNode.metadata?.prompt ? <div className="max-h-20 shrink-0 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed" style={{ color: theme.node.muted }}>{previewNode.metadata.prompt}</div> : null}
                        </motion.div>
                    ) : null}
                </AnimatePresence>,
                document.body,
            ) : null}
        </div>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// 藏卷阁 Tab —— 按类型折叠分组 + 标签筛选,点击插入画布
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; label: string; icon: typeof Square }[] = [
    { kind: "image", label: "图片", icon: ImageIcon },
    { kind: "video", label: "视频", icon: Video },
    { kind: "text", label: "文本", icon: FileText },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const serverAssetHasMore = useAssetStore((state) => state.serverAssetHasMore);
    const serverAssetLoading = useAssetStore((state) => state.serverAssetLoading);
    const loadMoreServerAssets = useAssetStore((state) => state.loadMoreServerAssets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading("正在加入藏卷阁…", 0);
        let added = 0;
        const statuses: AssetSyncStatus[] = [];
        const ownerUserId = useAssetStore.getState().ownerUserId;
        const expectedUserId = useUserStore.getState().user?.id || "";
        let accountChanged = false;
        const unsubscribe = useUserStore.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id) accountChanged = true; });
        const assertSaveOwner = () => {
            if (accountChanged || useAssetStore.getState().ownerUserId !== ownerUserId || (useUserStore.getState().user?.id || "") !== expectedUserId) throw new Error("账号已切换，请重新添加素材");
        };
        try {
            for (const file of files) {
                assertSaveOwner();
                let id: string;
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file, { expectedUserId });
                    assertSaveOwner();
                    id = addAsset({
                        kind: "image",
                        title: file.name || "图片",
                        coverUrl: image.thumbnailUrl || image.url,
                        tags: [],
                        data: {
                            dataUrl: image.url,
                            storageKey: image.storageKey,
                            thumbnailKey: image.thumbnailKey,
                            thumbnailUrl: image.thumbnailUrl,
                            width: image.width,
                            height: image.height,
                            bytes: image.bytes,
                            mimeType: image.mimeType,
                        },
                    });
                } else if (file.type.startsWith("video/")) {
                    const media = await uploadMediaFile(file, "video", expectedUserId);
                    assertSaveOwner();
                    id = addAsset({ kind: "video", title: file.name || "视频", coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
                } else continue;
                statuses.push(await useAssetStore.getState().waitForAssetLocalSave(id));
                assertSaveOwner();
                added += 1;
            }
            if (added) {
                const status = statuses.includes("failed") ? "failed" : statuses.includes("pending") ? "pending" : statuses.includes("local") ? "local" : "synced";
                message.open({ type: status === "failed" ? "warning" : status === "pending" ? "info" : "success", content: `${assetSaveMessage(status)}，共 ${added} 项` });
            }
            else message.warning("仅支持图片或视频文件");
        } catch (error) {
            console.error(error);
            message.error(userFacingErrorMessage(error, "素材未能添加，请再试一次"));
        } finally {
            unsubscribe();
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索藏卷阁" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <Plus className="size-3.5" />
                    添加
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        全部
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{group.label}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(buildInsertPayload(asset))} onRemove={() => { void removeAsset(asset.id).then(() => message.success("已从藏卷阁移除")).catch(() => message.error("移除失败，素材已保留，请重试")); }} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="藏卷阁暂无内容" className="pt-16" />
                )}
                {serverAssetHasMore ? (
                    <button
                        type="button"
                        className="mx-auto mt-3 block rounded-md px-3 py-1.5 text-xs font-medium opacity-65 transition hover:bg-black/5 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                        disabled={serverAssetLoading}
                        onClick={() => void loadMoreServerAssets()}
                    >
                        {serverAssetLoading ? "正在加载…" : "加载更多藏卷阁"}
                    </button>
                ) : null}
            </div>
        </div>
    );
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    return (
        <div className="group relative aspect-square overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <AssetCover asset={asset} />
            <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label="插入画布"
                >
                    <Plus className="size-4" />
                </button>
                <Popconfirm title="从藏卷阁移除该内容?" okText="移除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label="从藏卷阁移除"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") {
        if (asset.coverUrl) return <DeferredImage src={asset.coverUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" fetchPriority="low" />;
        return <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
    }
    return <DeferredImage src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" fetchPriority="low" />;
}

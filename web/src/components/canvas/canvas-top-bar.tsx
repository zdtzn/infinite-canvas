import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Bot, Download, GitBranch, Home, Menu, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { CultivationStatusPill } from "@/features/cultivation/status-pill";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import type { CanvasProjectSnapshot } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { DOCS_URL } from "@/constant/env";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onCreateBranch,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    snapshots = [],
    onCreateSnapshot = () => undefined,
    onRestoreSnapshot = () => undefined,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onCreateBranch: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins?: () => void;
    onUndo: () => void;
    onRedo: () => void;
    snapshots?: CanvasProjectSnapshot[];
    onCreateSnapshot?: () => void;
    onRestoreSnapshot?: (snapshot: CanvasProjectSnapshot) => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="@container/canvas-top pointer-events-none absolute left-0 right-0 top-0 z-[70] flex h-16 items-center justify-between gap-2 px-2">
                <div className="canvas-liquid-glass canvas-liquid-glass-surface canvas-animate-blur-fade-up pointer-events-auto flex min-w-0 items-center gap-1 rounded-xl px-1 py-1 @min-[360px]/canvas-top:px-1.5 @min-[900px]/canvas-top:gap-2" style={{ animationDelay: "0ms" }}>
                    <Tooltip title={sidePanelOpen ? "收起面板" : "展开面板"}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? "收起面板" : "展开面板"}
                            className="grid size-11 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10 @min-[900px]/canvas-top:size-8"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Tooltip title="返回洞天列表">
                        <button
                            type="button"
                            onClick={onProjects}
                            className="hidden size-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10 @min-[360px]/canvas-top:flex @min-[900px]/canvas-top:h-8 @min-[900px]/canvas-top:w-auto @min-[900px]/canvas-top:px-2"
                            style={{ color: theme.node.text }}
                            aria-label="返回洞天列表"
                        >
                            <ArrowLeft className="size-4" />
                            <span className="hidden @min-[900px]/canvas-top:inline">洞天</span>
                        </button>
                    </Tooltip>
                    <Tooltip title="返回首页">
                        <button
                            type="button"
                            onClick={onHome}
                            className="hidden size-11 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10 @min-[500px]/canvas-top:grid @min-[900px]/canvas-top:size-8"
                            style={{ color: theme.node.text }}
                            aria-label="返回首页"
                        >
                            <Home className="size-4" />
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "文档", onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "branch", icon: <GitBranch className="size-4" />, label: "从当前画布创建分支", onClick: onCreateBranch },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: "导出当前画布", onClick: onExportProject },
                                { key: "snapshot-create", icon: <Plus className="size-4" />, label: "保存当前快照", onClick: onCreateSnapshot },
                                ...(snapshots.length
                                    ? [
                                          {
                                              key: "snapshots",
                                              icon: <BookOpen className="size-4" />,
                                              label: "恢复快照",
                                              children: snapshots.slice(0, 8).map((snapshot) => ({
                                                  key: snapshot.id,
                                                  label: snapshot.title,
                                                  onClick: () => onRestoreSnapshot(snapshot),
                                              })),
                                          },
                                      ]
                                    : []),
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                                { key: "home", icon: <Home className="size-4" />, label: "返回首页", onClick: onHome },
                                { key: "projects", icon: <ArrowLeft className="size-4" />, label: "返回洞天列表", onClick: onProjects },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10 @min-[900px]/canvas-top:size-8" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="hidden min-w-0 items-center gap-2 @min-[900px]/canvas-top:flex">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-full min-w-0 max-w-[240px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[240px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <div className="hidden shrink-0 @min-[1240px]/canvas-top:block">
                        <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} />
                    </div>
                </div>

                <div
                    className="canvas-liquid-glass canvas-liquid-glass-surface canvas-animate-blur-fade-up pointer-events-auto flex shrink-0 items-center gap-1 rounded-xl px-1 py-1 [&_button]:min-h-11 [&_button]:min-w-11 @min-[360px]/canvas-top:px-1.5 @min-[900px]/canvas-top:[&_button]:min-h-7 @min-[900px]/canvas-top:[&_button]:min-w-7"
                    style={{ animationDelay: "120ms" }}
                >
                    <div className="hidden @min-[1240px]/canvas-top:block">
                        <CultivationStatusPill />
                    </div>
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    <span className="hidden h-6 w-px @min-[900px]/canvas-top:block" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        aria-label={agentOpen ? "收起 Agent" : "打开 Agent"}
                        className="!h-11 !shrink-0 !rounded-lg !px-2 !font-medium @min-[900px]/canvas-top:!h-10 @min-[900px]/canvas-top:!px-3"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        <span className="hidden @min-[900px]/canvas-top:inline">Agent</span>
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "Codex 已连接" : status.enabled ? `Codex ${status.activity || "连接中"}` : "Codex 未连接";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="flex h-8 items-center gap-1.5 text-xs transition hover:opacity-75" style={{ color: status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.muted }} onClick={onClick} title="打开本地 Codex 面板">
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

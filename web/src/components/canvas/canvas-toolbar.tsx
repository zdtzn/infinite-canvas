import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Segmented, Switch } from "antd";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, CircleDot, Columns2, Eraser, Eye, EyeOff, Film, Grid2x2, Grid3X3, Group, Hand, Image as ImageIcon, Info, Lock, Moon, Music2, Palette, Plus, Puzzle, Redo2, Settings2, Square, Sun, Trash2, Type, Undo2, Unlock, Upload, Video } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export function CanvasToolbar({
    selectedCount,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    canvasBackdropEnabled,
    allSelectedLocked,
    allSelectedHidden,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onCanvasBackdropEnabledChange,
    onToggleLock,
    onToggleHidden,
    onAlign,
    onCompare,
}: {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    canvasBackdropEnabled: boolean;
    allSelectedLocked: boolean;
    allSelectedHidden: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onCanvasBackdropEnabledChange: (enabled: boolean) => void;
    onToggleLock: () => void;
    onToggleHidden: () => void;
    onAlign: (mode: "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical" | "grid") => void;
    onCompare: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    // 扩展(插件)节点,随注册表变化实时更新
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered) : "";

    // 点击工具栏(含弹出面板)以外的地方,关闭弹出的扩展节点/画布外观面板
    useEffect(() => {
        if (!appearanceOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setAppearanceOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [appearanceOpen]);

    return (
        <div ref={rootRef} data-canvas-toolbar-root className="pointer-events-none absolute bottom-5 left-4 right-4 z-50 flex justify-center">
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div className="canvas-liquid-glass canvas-liquid-glass-surface canvas-animate-blur-fade-up pointer-events-auto max-w-full rounded-xl" style={{ animationDelay: "260ms" }}>
                <div ref={wrapRef} className="thin-scrollbar flex h-14 max-w-full items-center gap-1 overflow-x-auto px-2 [&>*]:shrink-0" style={{ color: theme.toolbar.item }}>
                    <ToolbarButton id="tool-hand" label="移动/选择" active={!selectedCount} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDeselect}>
                        <Hand className="size-4.5" />
                    </ToolbarButton>
                    <ToolbarButton id="tool-undo" label="撤销" disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                        <Undo2 className="size-4.5" />
                    </ToolbarButton>
                    <ToolbarButton id="tool-redo" label="重做" disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                        <Redo2 className="size-4.5" />
                    </ToolbarButton>
                    <Divider theme={theme} />
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "text", icon: <Type className="size-4" />, label: "文本", onClick: onAddText },
                                { key: "image", icon: <ImageIcon className="size-4" />, label: "图片", onClick: onAddImage },
                                { key: "video", icon: <Video className="size-4" />, label: "视频", onClick: onAddVideo },
                                { key: "audio", icon: <Music2 className="size-4" />, label: "音频", onClick: onAddAudio },
                                { type: "divider" },
                                { key: "config", icon: <Settings2 className="size-4" />, label: "生成配置", onClick: onAddConfig },
                                { key: "group", icon: <Group className="size-4" />, label: "分组", onClick: onAddGroup },
                                ...extensionDefs.map((def) => ({ key: def.type, icon: <Puzzle className="size-4" />, label: def.title, onClick: () => onAddExtensionNode(def.type) })),
                            ],
                        }}
                    >
                        <span>
                            <ToolbarButton id="tool-create" label="新建节点" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={() => undefined}>
                                <Plus className="size-4.5" />
                            </ToolbarButton>
                        </span>
                    </Dropdown>
                <ToolbarButton id="tool-upload" label="上传素材" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUpload}>
                        <Upload className="size-4.5" />
                    </ToolbarButton>
                    <Divider theme={theme} />
                    <ToolbarButton
                        id="tool-style"
                        label="画布外观"
                        active={appearanceOpen}
                        hovered={hovered}
                        activeStyle={activeStyle}
                        hoverStyle={hoverStyle}
                        wrapRef={wrapRef}
                        onTipX={setTipX}
                        onHover={setHovered}
                        onClick={(event) => {
                            setPanelX(getTipX(wrapRef.current, event.currentTarget));
                            setAppearanceOpen((value) => !value);
                        }}
                    >
                        <Palette className="size-4.5" />
                    </ToolbarButton>
                    {selectedCount ? (
                        <>
                            <Divider theme={theme} />
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "lock", icon: allSelectedLocked ? <Unlock className="size-4" /> : <Lock className="size-4" />, label: allSelectedLocked ? "解锁选中" : "锁定选中", onClick: onToggleLock },
                                        { key: "hidden", icon: allSelectedHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />, label: allSelectedHidden ? "显示选中" : "隐藏选中", onClick: onToggleHidden },
                                        { type: "divider" },
                                        { key: "left", icon: <AlignStartHorizontal className="size-4" />, label: "左对齐", onClick: () => onAlign("left") },
                                        { key: "center", icon: <AlignCenterHorizontal className="size-4" />, label: "水平居中", onClick: () => onAlign("center") },
                                        { key: "right", icon: <AlignEndHorizontal className="size-4" />, label: "右对齐", onClick: () => onAlign("right") },
                                        { key: "top", icon: <AlignStartVertical className="size-4" />, label: "顶对齐", onClick: () => onAlign("top") },
                                        { key: "middle", icon: <AlignCenterVertical className="size-4" />, label: "垂直居中", onClick: () => onAlign("middle") },
                                        { key: "bottom", icon: <AlignEndVertical className="size-4" />, label: "底对齐", onClick: () => onAlign("bottom") },
                                        { key: "horizontal", icon: <AlignHorizontalSpaceAround className="size-4" />, label: "水平等距", onClick: () => onAlign("horizontal") },
                                        { key: "vertical", icon: <AlignVerticalSpaceAround className="size-4" />, label: "垂直等距", onClick: () => onAlign("vertical") },
                                        { key: "grid", icon: <Grid3X3 className="size-4" />, label: "吸附网格", onClick: () => onAlign("grid") },
                                    ],
                                }}
                            >
                                <span>
                                    <ToolbarButton id="tool-layout" label="锁定、隐藏与排版" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={() => undefined}>
                                        <Grid3X3 className="size-4.5" />
                                    </ToolbarButton>
                                </span>
                            </Dropdown>
                            {selectedCount === 2 ? (
                                <ToolbarButton id="tool-compare" label="比较选中版本" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onCompare}>
                                    <Columns2 className="size-4.5" />
                                </ToolbarButton>
                            ) : null}
                            <ToolbarButton id="tool-delete" label="删除选中" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                                <Trash2 className="size-4.5" />
                            </ToolbarButton>
                        </>
                    ) : null}
                    <Divider theme={theme} />
                    <ToolbarButton id="tool-clear" label="清空画布" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                        <Eraser className="size-4.5" />
                    </ToolbarButton>
                </div>
            </div>

            {appearanceOpen ? (
                <div className="canvas-liquid-glass canvas-liquid-glass-surface canvas-liquid-glass-absolute pointer-events-auto bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl p-2.5" style={{ left: panelX || "50%", color: theme.toolbar.item }}>
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">画布外观</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">主题模式</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            浅色
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            深色
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Film className="size-3.5" />
                            动态背景
                        </span>
                        <Switch size="small" checked={canvasBackdropEnabled} onChange={onCanvasBackdropEnabledChange} aria-label="切换动态画布背景" />
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">网格样式</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />点
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />线
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        空白
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            图片信息
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Button
            type="text"
            aria-label={label}
            className="!h-8 !w-8 !min-w-8 !p-0"
            disabled={disabled}
            style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "#f87171" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
            title={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string) {
    if (id === "tool-hand") return "移动/选择";
    if (id === "tool-undo") return "撤销";
    if (id === "tool-redo") return "重做";
    if (id === "tool-text") return "文本";
    if (id === "tool-image") return "图片";
    if (id === "tool-video") return "视频";
    if (id === "tool-audio") return "音频";
    if (id === "tool-config") return "生成配置";
    if (id === "tool-group") return "组";
    if (id === "tool-extensions") return "扩展节点";
    if (id === "tool-upload") return "上传素材";
    if (id === "tool-style") return "画布外观";
    if (id === "tool-delete") return "删除选中";
    if (id === "tool-clear") return "清空画布";
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.closest<HTMLElement>("[data-canvas-toolbar-root]")?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}

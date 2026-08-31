import { Dropdown, Tooltip } from "antd";
import { ArrowLeft, ClipboardCopy, ClipboardPaste, Columns2, Download, Ellipsis, FileImage, PanelLeft, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

type ColorAlchemyToolbarProps = {
    title: string;
    canReturn: boolean;
    returning: boolean;
    canUndo: boolean;
    canRedo: boolean;
    originalPinned: boolean;
    saving: boolean;
    onReturn: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCompareStart: () => void;
    onCompareEnd: () => void;
    onToggleOriginal: () => void;
    onReset: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSave: () => void;
    onExport: () => void;
    onOpenSources: () => void;
};

export function ColorAlchemyToolbar({
    title,
    canReturn,
    returning,
    canUndo,
    canRedo,
    originalPinned,
    saving,
    onReturn,
    onUndo,
    onRedo,
    onCompareStart,
    onCompareEnd,
    onToggleOriginal,
    onReset,
    onCopy,
    onPaste,
    onSave,
    onExport,
    onOpenSources,
}: ColorAlchemyToolbarProps) {
    const endCompare = (target?: HTMLElement, pointerId?: number) => {
        if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        onCompareEnd();
    };

    return (
        <header className="color-alchemy-toolbar">
            <div className="flex min-w-0 items-center gap-2">
                <ToolbarIcon title="打开灵彩素材" icon={<PanelLeft className="size-4" />} className="color-toolbar-mobile-only" onClick={onOpenSources} />
                {canReturn ? (
                    <button type="button" className="color-toolbar-back" onClick={onReturn} disabled={returning}>
                        <ArrowLeft className="size-4" />
                        <span className="hidden sm:inline">{returning ? "正在返回" : "返回画布"}</span>
                    </button>
                ) : null}
                <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                        <h1 className="truncate text-sm font-semibold text-white/90">灵彩设计</h1>
                        <span className="hidden text-[10px] text-white/28 md:inline">COLOR ALCHEMY</span>
                    </div>
                    <div className="max-w-44 truncate text-[11px] text-white/38 sm:max-w-64 xl:max-w-80">{title}</div>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center">
                    <ToolbarIcon title="撤销" icon={<Undo2 className="size-4" />} disabled={!canUndo} onClick={onUndo} />
                    <ToolbarIcon title="重做" icon={<Redo2 className="size-4" />} disabled={!canRedo} onClick={onRedo} />
                </div>

                <button
                    type="button"
                    className="color-toolbar-compare hidden md:flex"
                    aria-label="按住查看原图"
                    title="按住查看原图"
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        onCompareStart();
                    }}
                    onPointerUp={(event) => endCompare(event.currentTarget, event.pointerId)}
                    onPointerCancel={(event) => endCompare(event.currentTarget, event.pointerId)}
                    onLostPointerCapture={onCompareEnd}
                    onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") onCompareStart();
                    }}
                    onKeyUp={(event) => {
                        if (event.key === " " || event.key === "Enter") onCompareEnd();
                    }}
                >
                    <Columns2 className="size-4" />
                    对比
                </button>

                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "original", icon: <FileImage className="size-4" />, label: originalPinned ? "退出原图视图" : "固定查看原图", onClick: onToggleOriginal },
                            { key: "reset", icon: <RotateCcw className="size-4" />, label: "恢复全部调整", onClick: onReset },
                            { type: "divider" },
                            { key: "copy", icon: <ClipboardCopy className="size-4" />, label: "复制调色参数", onClick: onCopy },
                            { key: "paste", icon: <ClipboardPaste className="size-4" />, label: "粘贴调色参数", onClick: onPaste },
                        ],
                    }}
                >
                    <button type="button" className="color-toolbar-icon" aria-label="更多操作" title="更多操作">
                        <Ellipsis className="size-4" />
                    </button>
                </Dropdown>

                <span className="mx-1 hidden h-5 w-px bg-white/8 lg:block" />
                <button type="button" className="color-toolbar-save hidden lg:flex" disabled={saving} onClick={onSave}>
                    <Save className="size-4" />
                    {saving ? "保存中" : "保存"}
                </button>
                <button type="button" className="color-toolbar-export hidden lg:flex" onClick={onExport}>
                    <Download className="size-4" />
                    导出
                </button>
            </div>
        </header>
    );
}

function ToolbarIcon({ title, icon, disabled, className = "", onClick }: { title: string; icon: React.ReactNode; disabled?: boolean; className?: string; onClick: () => void }) {
    return (
        <Tooltip title={title}>
            <button type="button" className={`color-toolbar-icon ${className}`} disabled={disabled} onClick={onClick} aria-label={title}>
                {icon}
            </button>
        </Tooltip>
    );
}

import { Dropdown, Tooltip } from "antd";
import { ArrowLeft, ClipboardCopy, ClipboardPaste, Download, Ellipsis, FileImage, PanelLeft, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

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
    onToggleOriginal: () => void;
    onReset: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSave: () => void;
    onExport: () => void;
    onOpenSources: () => void;
};

export function ColorAlchemyToolbar({ title, canReturn, returning, canUndo, canRedo, originalPinned, saving, onReturn, onUndo, onRedo, onToggleOriginal, onReset, onCopy, onPaste, onSave, onExport, onOpenSources }: ColorAlchemyToolbarProps) {
    return (
        <header className="color-alchemy-toolbar">
            <div className="flex min-w-0 items-center gap-2">
                <ToolbarIcon title="展开或收起素材与风格" icon={<PanelLeft className="size-4" />} onClick={onOpenSources} />
                {canReturn ? (
                    <button type="button" className="color-toolbar-back" onClick={onReturn} disabled={returning}>
                        <ArrowLeft className="size-4" />
                        <span className="hidden sm:inline">{returning ? "正在返回" : "返回画布"}</span>
                    </button>
                ) : null}
                <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                        <h1 className="truncate text-sm font-semibold text-white/90">灵彩设计</h1>
                        <span className="hidden text-xs text-white/60 md:inline">调色工作台</span>
                    </div>
                    <div className="max-w-28 truncate text-xs text-white/60 sm:max-w-64 xl:max-w-80">{title}</div>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center">
                    <ToolbarIcon title="撤销" icon={<Undo2 className="size-4" />} disabled={!canUndo} onClick={onUndo} />
                    <ToolbarIcon title="重做" icon={<Redo2 className="size-4" />} disabled={!canRedo} onClick={onRedo} />
                </div>

                <button type="button" className="color-toolbar-compare hidden md:flex" onClick={onReset}>
                    <RotateCcw className="size-4" />
                    重置调整
                </button>

                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "original", icon: <FileImage className="size-4" />, label: originalPinned ? "退出原图视图" : "固定查看原图", onClick: onToggleOriginal },
                            { key: "reset", icon: <RotateCcw className="size-4" />, label: "重置全部调整（可撤销）", onClick: onReset },
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
                    {saving ? "保存中" : "保存到藏卷阁"}
                </button>
                <button type="button" className="color-toolbar-export hidden lg:flex" onClick={onExport}>
                    <Download className="size-4" />
                    导出文件
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

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Camera, Film, Plus, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export function CanvasNodeContextMenu({
    menu,
    onClose,
    onDuplicate,
    onDelete,
    onCamera,
    onMediaTools,
    toolsDisabled,
}: {
    menu: ContextMenuState;
    onClose: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onCamera?: () => void;
    onMediaTools?: () => void;
    toolsDisabled?: boolean;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{
                left: Math.max(8, Math.min(menu.x, window.innerWidth - 192)),
                top: Math.max(8, Math.min(menu.y, window.innerHeight - 210)),
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
                background: theme.toolbar.panel,
                borderColor: theme.toolbar.border,
                color: theme.node.text,
            }}
            data-canvas-no-zoom
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            {onCamera ? <MenuButton icon={<Camera className="size-4" />} label="摄影参数" onClick={onCamera} disabled={toolsDisabled} /> : null}
            {onMediaTools ? <MenuButton icon={<Film className="size-4" />} label="截帧 / 音频工具" onClick={onMediaTools} disabled={toolsDisabled} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false, disabled }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button
            type="button"
            disabled={disabled}
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ color: danger ? "#f87171" : theme.node.text }}
            onClick={onClick}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

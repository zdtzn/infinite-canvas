import { Group, Ungroup } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasSelectionToolbar({ count, canGroup, canUngroup, onGroup, onUngroup }: { count: number; canGroup: boolean; canUngroup: boolean; onGroup: () => void; onUngroup: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            role="toolbar"
            aria-label="选区操作"
            className="absolute left-1/2 top-14 z-[110] flex -translate-x-1/2 items-center gap-3 px-3 py-2 text-xs"
            style={{ background: theme.toolbar.panel, color: theme.toolbar.item }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <span>已选 {count} 项</span>
            <button type="button" disabled={!canGroup} onClick={onGroup} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40">
                <Group size={14} />
                组合
            </button>
            <button type="button" disabled={!canUngroup} onClick={onUngroup} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40">
                <Ungroup size={14} />
                取消组合
            </button>
        </div>
    );
}

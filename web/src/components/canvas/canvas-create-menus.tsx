import { useEffect, useLayoutEffect, useRef } from "react";
import { ImageIcon, List, Music2, Settings2, Video, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

function useCanvasMenuPosition(position: Position, scale: number) {
    const menuRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const place = () => {
            menu.style.marginLeft = "0px";
            menu.style.marginTop = "0px";
            const dock = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
            const zoom = document.querySelector('[aria-label="重置视图"]')?.closest(".canvas-liquid-glass")?.parentElement?.getBoundingClientRect();
            const top = Math.min(64, window.innerHeight / 4);
            const bottom = Math.min(window.innerHeight - 12, dock ? dock.top - 12 : Infinity, zoom ? zoom.top - 12 : Infinity);
            menu.style.maxHeight = `${Math.min(window.innerHeight * 0.7, Math.max(44, bottom - top))}px`;
            const rect = menu.getBoundingClientRect();
            const left = Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12));
            const nextTop = Math.max(top, Math.min(rect.top, bottom - rect.height));
            menu.style.marginLeft = `${(left - rect.left) / scale}px`;
            menu.style.marginTop = `${(nextTop - rect.top) / scale}px`;
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [position.x, position.y, scale]);
    return menuRef;
}

export function ConnectionCreateMenu({
    pending,
    scale = 1,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    scale?: number;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useCanvasMenuPosition(pending.position, scale);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-60 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border p-2 shadow-2xl backdrop-blur thin-scrollbar"
            data-connection-create-menu
            data-canvas-no-zoom
            role="group"
            aria-label="引用节点生成"
            style={{ left: pending.position.x, top: pending.position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
        >
            <div className="mb-1 flex items-center justify-between pl-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label="关闭">
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: theme.node.text }}
            onClick={onClick}
        >
            <span className="grid size-8 shrink-0 place-items-center [&>svg]:size-4" style={{ color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-5">{title}</span>
                {description ? (
                    <span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, scale = 1, onCreate, onClose }: { position: Position; scale?: number; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion();
    const menuRef = useCanvasMenuPosition(position, scale);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // 点击菜单外的空白处自动关闭
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-60 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border p-2 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            role="group"
            aria-label="新建节点"
            style={{ left: position.x, top: position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
        >
            <div className="mb-1 flex items-center justify-between pl-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    选择节点
                </span>
                <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label="关闭">
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}

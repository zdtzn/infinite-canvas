import { useRef, useState } from "react";
import { Popover } from "antd";
import { FileText, Group, Image as ImageIcon, Music2, Plus, Video, X } from "lucide-react";

import { DeferredImage } from "@/components/ui/deferred-image";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";

type ReferenceBarProps = {
    nodeId: string;
    references: CanvasResourceReference[];
    currentImage?: CanvasResourceReference;
    onDisconnect?: (sourceNodeId: string, targetNodeId: string) => void;
    onStartSelection?: (nodeId: string) => void;
};

export function CanvasNodeReferenceBar({ nodeId, references, currentImage, onDisconnect, onStartSelection }: ReferenceBarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sources = new Map<string, CanvasResourceReference[]>();
    references.forEach((reference) => {
        const sourceId = reference.sourceNodeId || reference.nodeId;
        const source = sources.get(sourceId) || [];
        source.push(reference);
        sources.set(sourceId, source);
    });
    if (!references.length && !currentImage && !onStartSelection) return null;

    return (
        <section
            data-canvas-reference-bar
            data-canvas-no-zoom
            aria-label="已连接素材"
            className="mb-2 min-w-0 rounded-2xl px-3 py-1"
            style={{ background: theme.toolbar.panel, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
                <span style={{ color: theme.node.muted }}>已连接素材{references.length ? ` · ${references.length}` : ""}</span>
                {onStartSelection ? <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/10" onClick={() => onStartSelection(nodeId)}><Plus className="size-3.5" aria-hidden="true" />选择参考</button> : null}
            </div>
            {references.length || currentImage ? (
                <div className="thin-scrollbar flex items-end gap-3 overflow-x-auto pb-1">
                    {currentImage ? <ReferenceItem reference={currentImage} /> : null}
                    {[...sources.entries()].map(([sourceId, items]) => {
                        const first = items[0];
                        const isGroup = sourceId !== first.nodeId;
                        const removeLabel = isGroup ? `移除整组「${first.sourceTitle || "分组"}」引用` : `移除${first.label}引用`;
                        return (
                            <div key={sourceId} className="flex shrink-0 items-end gap-1.5" role={isGroup ? "group" : undefined} aria-label={isGroup ? `${first.sourceTitle || "分组"} · 整组引用` : undefined}>
                                {items.map((reference) => <ReferenceItem key={reference.id} reference={reference} />)}
                                {onDisconnect ? (
                                    <button type="button" className="mb-4 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/10" style={{ color: theme.node.muted }} aria-label={removeLabel} title={removeLabel} onClick={() => onDisconnect(sourceId, first.connectionTargetId || nodeId)}>
                                        {isGroup ? <><Group className="size-3.5" aria-hidden="true" /><span className="max-w-24 truncate">移除整组</span></> : null}<X className="size-3.5" aria-hidden="true" />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : <p className="mb-2 mt-0 text-xs" style={{ color: theme.node.muted }}>选择画布中的图片、文字或分组作为参考</p>}
            {currentImage ? <p className="mb-1 mt-1 text-[11px]" style={{ color: theme.node.muted }}>当前图片会一同作为参考</p> : null}
        </section>
    );
}

function ReferenceItem({ reference }: { reference: CanvasResourceReference }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const [failedThumbnail, setFailedThumbnail] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const Icon = reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Video : reference.kind === "audio" ? Music2 : FileText;
    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <Popover
            placement="topLeft"
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            destroyOnHidden
            content={<div>{open ? <ReferencePreview reference={reference} onClose={close} /> : null}</div>}
        >
            <button ref={triggerRef} type="button" className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: theme.node.text }} aria-label={`预览${reference.label}：${reference.title}`} aria-haspopup="dialog" aria-expanded={open} title={reference.sourceTitle ? `${reference.title} · 来自「${reference.sourceTitle}」` : reference.title} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
                <span className="relative grid size-12 place-items-center overflow-hidden rounded-lg" style={{ color: theme.node.muted }}>
                    <Icon className="size-5" aria-hidden="true" />
                    {reference.kind === "image" && reference.thumbnailUrl && failedThumbnail !== reference.thumbnailUrl ? <DeferredImage src={reference.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailedThumbnail(reference.thumbnailUrl!)} draggable={false} /> : null}
                    {reference.kind === "text" ? <span className="absolute inset-0 overflow-hidden bg-inherit p-1 text-left text-[10px] leading-3" style={{ background: theme.toolbar.panel }}>{reference.text?.slice(0, 54)}</span> : null}
                </span>
                <span className="max-w-full truncate text-[11px] leading-4">{reference.label}</span>
            </button>
        </Popover>
    );
}

function ReferencePreview({ reference, onClose }: { reference: CanvasResourceReference; onClose: () => void }) {
    return (
        <div role="dialog" aria-label={`${reference.label}预览`} className="w-[min(320px,calc(100vw-64px))]" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
            <div className="mb-2 flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 break-words text-xs">{reference.title}{reference.sourceTitle ? ` · 来自「${reference.sourceTitle}」` : ""}</span>
                <button type="button" autoFocus className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label="关闭参考预览" onClick={onClose}><X className="size-4" aria-hidden="true" /></button>
            </div>
            {reference.kind === "image" && reference.previewUrl ? <img src={reference.previewUrl} alt={reference.title} decoding="async" className="max-h-[50dvh] w-full rounded-lg object-contain" />
                : reference.kind === "video" && reference.previewUrl ? <video src={reference.previewUrl} controls preload="metadata" className="max-h-[50dvh] w-full rounded-lg" />
                : reference.kind === "audio" && reference.previewUrl ? <audio src={reference.previewUrl} controls preload="metadata" className="w-full" />
                : <div className="thin-scrollbar max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{reference.text || reference.title}</div>}
        </div>
    );
}

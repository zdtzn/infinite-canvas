import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Input, Modal, Slider, Tooltip } from "antd";
import { Brush, Hand, Scan, Sparkles, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { readImageBlob } from "@/services/image-storage";
import { drawEditSelection, encodeLocalImageEdit, selectionBounds, type EditPoint, type EditRegion, type EditSelection, type LocalImageEdit } from "./local-image-edit";

const MAX_REGIONS = 8;
const MIN_BOX_SIDE = 4;
const MAX_STROKE_POINTS = 500;

type Props = {
    source: { dataUrl: string; name: string };
    ownerUserId: string;
    modelLabel: string;
    quotaLabel: string;
    transparentBackground: boolean;
    blockReason: string | null;
    allowGuide: boolean;
    onClose: () => void;
    onSubmit: (edit: LocalImageEdit, signal: AbortSignal) => Promise<void>;
};

export function LocalImageEditDialog({ source, ownerUserId, modelLabel, quotaLabel, transparentBackground, blockReason, allowGuide, onClose, onSubmit }: Props) {
    const [imageUrl, setImageUrl] = useState("");
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [regions, setRegions] = useState<EditRegion[]>([]);
    const [draft, setDraft] = useState<EditSelection | null>(null);
    const [activeId, setActiveId] = useState("");
    const [mode, setMode] = useState<"box" | "brush" | "move">("box");
    const [brush, setBrush] = useState(26);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const previewRef = useRef<HTMLCanvasElement>(null);
    const gesture = useRef<{ pointerId: number; rect: DOMRect; selection: EditSelection } | null>(null);
    const submitRef = useRef<AbortController>(null);
    const nextId = useRef(0);
    const viewport = useImageEditorViewport(size, true, mode === "move");

    useEffect(() => {
        const controller = new AbortController();
        let url = "";
        void readImageBlob(source.dataUrl, ownerUserId, { signal: controller.signal }).then((blob) => {
            if (controller.signal.aborted) return;
            url = URL.createObjectURL(blob);
            setImageUrl(url);
        }).catch((reason) => {
            if (!controller.signal.aborted) setError(userFacingErrorMessage(reason, "原图读取失败，请关闭后重试"));
        });
        return () => {
            controller.abort();
            if (url) URL.revokeObjectURL(url);
            submitRef.current?.abort();
        };
    }, [ownerUserId, source.dataUrl]);

    // Draw at the displayed fit size. The submitted mask uses the natural pixel size.
    const previewWidth = Math.round(viewport.mediaStyle.width);
    const previewHeight = Math.round(viewport.mediaStyle.height);
    useEffect(() => {
        const context = previewRef.current?.getContext("2d");
        if (!context || !previewWidth || !previewHeight) return;
        const previewSize = { width: previewWidth, height: previewHeight };
        context.clearRect(0, 0, previewWidth, previewHeight);
        for (const region of regions) {
            context.fillStyle = context.strokeStyle = region.id === activeId ? "rgba(56, 148, 255, .56)" : "rgba(56, 148, 255, .29)";
            drawEditSelection(context, region.selection, previewSize);
        }
        if (draft) {
            context.fillStyle = context.strokeStyle = "rgba(56, 148, 255, .62)";
            drawEditSelection(context, draft, previewSize);
        }
    }, [activeId, draft, previewHeight, previewWidth, regions]);

    const pointAt = (event: PointerEvent<HTMLCanvasElement>, rect: DOMRect): EditPoint => {
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
        };
    };

    const start = (event: PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || gesture.current || submitting || mode === "move" || regions.length >= MAX_REGIONS || !size) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        const point = pointAt(event, rect);
        const selection: EditSelection = mode === "box"
            ? { mode, start: point, end: point }
            : { mode, points: [point], diameter: brush / Math.max(1, Math.min(rect.width, rect.height)) };
        gesture.current = { pointerId: event.pointerId, rect, selection };
        setDraft(selection);
        setError("");
    };

    const move = (event: PointerEvent<HTMLCanvasElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const point = pointAt(event, current.rect);
        const selection = current.selection;
        if (selection.mode === "box") current.selection = { ...selection, end: point };
        else {
            const last = selection.points.at(-1)!;
            const step = selection.diameter / 12;
            if (selection.points.length < MAX_STROKE_POINTS && Math.hypot(point.x - last.x, point.y - last.y) >= step)
                current.selection = { ...selection, points: [...selection.points, point] };
        }
        setDraft(current.selection);
    };

    const finish = (event: PointerEvent<HTMLCanvasElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const selection = current.selection.mode === "box"
            ? { ...current.selection, end: pointAt(event, current.rect) }
            : current.selection;
        gesture.current = null;
        setDraft(null);
        if (event.type !== "pointerup" || !size) return;
        if (selection.mode === "box") {
            const bounds = selectionBounds(selection, size);
            if ((bounds.right - bounds.left) * current.rect.width < MIN_BOX_SIDE || (bounds.bottom - bounds.top) * current.rect.height < MIN_BOX_SIDE) return;
        }
        const id = String(++nextId.current);
        setRegions((currentRegions) => [...currentRegions, { id, selection, note: "" }]);
        setActiveId(id);
    };

    const removeRegion = (id?: string) => {
        if (!id || gesture.current) return;
        const remaining = regions.filter((region) => region.id !== id);
        setRegions(remaining);
        if (activeId === id) setActiveId(remaining.at(-1)?.id || "");
        setError("");
    };

    const canSubmit = Boolean(size && regions.length && regions.every((region) => region.note.trim()) && !draft && !blockReason && !submitting);
    const submit = async () => {
        if (!canSubmit || submitRef.current || !imageRef.current) return;
        const controller = new AbortController();
        submitRef.current = controller;
        setSubmitting(true);
        setError("");
        try {
            const edit = await encodeLocalImageEdit(imageRef.current, regions, allowGuide);
            controller.signal.throwIfAborted();
            await onSubmit(edit, controller.signal);
        } catch (reason) {
            if (!controller.signal.aborted) setError(userFacingErrorMessage(reason, "局部编辑未能提交，请检查原图和选区后重试"));
        } finally {
            submitRef.current = null;
            if (!controller.signal.aborted) setSubmitting(false);
        }
    };

    return (
        <Modal
            title="局部编辑"
            open
            centered
            width={1050}
            styles={{ body: { maxHeight: "calc(100dvh - 176px)", overflowY: "auto" } }}
            mask={{ closable: false }}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>取消</Button>,
                <Button key="submit" type="primary" icon={<Sparkles className="size-4" />} loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>生成编辑图</Button>,
            ]}
        >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_305px]">
                <section className="min-w-0" aria-label="照片选区">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex flex-wrap items-center gap-1">
                            <Button size="small" type={mode === "box" ? "primary" : "text"} aria-pressed={mode === "box"} icon={<Scan className="size-4" />} onClick={() => setMode("box")}>框选</Button>
                            <Button size="small" type={mode === "brush" ? "primary" : "text"} aria-pressed={mode === "brush"} icon={<Brush className="size-4" />} onClick={() => setMode("brush")}>画笔</Button>
                            <Button size="small" type={mode === "move" ? "primary" : "text"} aria-pressed={mode === "move"} icon={<Hand className="size-4" />} onClick={() => setMode("move")}>移动</Button>
                            <Tooltip title="撤销最近一次选区"><Button size="small" type="text" icon={<Undo2 className="size-4" />} disabled={!regions.length || submitting} aria-label="撤销最近一次选区" onClick={() => removeRegion(regions.at(-1)?.id)} /></Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button size="small" type="text" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut} aria-label="缩小照片" onClick={viewport.zoomOut} />
                            <Button size="small" type="text" aria-label="重置照片缩放" onClick={viewport.resetZoom}>{Math.round(viewport.zoom * 100)}%</Button>
                            <Button size="small" type="text" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn} aria-label="放大照片" onClick={viewport.zoomIn} />
                        </div>
                    </div>
                    <div ref={viewport.viewportRef} {...viewport.panHandlers} className={`relative h-[min(37dvh,480px)] min-h-48 lg:h-[min(54dvh,520px)] rounded-lg border border-border bg-muted ${viewport.scrollClassName}`}>
                        {!size && <div role="status" className="absolute inset-0 grid place-items-center px-4 text-sm text-muted-foreground">{error ? "原图暂不可用" : "正在读取原图…"}</div>}
                        {imageUrl && (
                            <div className="relative" style={viewport.contentStyle}>
                                <div ref={viewport.stageRef} style={viewport.stageStyle} className="absolute isolate overflow-hidden select-none">
                                    <div className="absolute left-0 top-0" style={viewport.mediaStyle}>
                                        <img ref={imageRef} src={imageUrl} alt={source.name} draggable={false} className="absolute inset-0 size-full object-fill"
                                            onLoad={({ currentTarget }) => setSize({ width: currentTarget.naturalWidth, height: currentTarget.naturalHeight })}
                                            onError={() => setError("原图无法预览，请关闭后重试")} />
                                        <canvas ref={previewRef} width={previewWidth} height={previewHeight} aria-label="在照片上绘制修改区域" className={`absolute inset-0 size-full ${mode === "move" ? "pointer-events-none" : "cursor-crosshair touch-none"}`}
                                            onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
                                    </div>
                                    {size && regions.map(({ id, selection }, index) => {
                                        const { left, top } = selectionBounds(selection, size);
                                        return <span key={id} aria-hidden className="pointer-events-none absolute grid size-6 place-items-center rounded-full border border-white/80 bg-blue-700 text-xs font-semibold text-white shadow"
                                            style={{ left: `clamp(2px, ${left * 100}%, calc(100% - 26px))`, top: `clamp(2px, ${top * 100}%, calc(100% - 26px))` }}>{index + 1}</span>;
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    {mode === "brush" && (
                        <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                            <span>笔刷大小</span>
                            <Slider className="flex-1" min={6} max={96} value={brush} onChange={setBrush} aria-label="笔刷大小" />
                            <span className="w-10 text-right tabular-nums">{brush}px</span>
                        </div>
                    )}
                </section>
                <section aria-label="编辑注释" className="flex min-w-0 flex-col gap-3">
                    <div>
                        <h3 className="text-sm font-semibold">编辑注释</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{regions.length >= MAX_REGIONS ? `最多标注 ${MAX_REGIONS} 个区域，删除已有选区后可继续标注。` : "在照片上框选或涂抹，再为每个编号填写修改要求。"}</p>
                    </div>
                    <div className="space-y-2 lg:max-h-[min(42dvh,430px)] lg:overflow-y-auto lg:pr-1">
                        {regions.map((region, index) => (
                            <div key={region.id} className={`rounded-lg border p-2 ${activeId === region.id ? "border-primary/60" : "border-border"}`}>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <label htmlFor={`local-edit-note-${region.id}`} className="text-sm font-medium">区域 {index + 1}</label>
                                    <Button type="text" size="small" icon={<Trash2 className="size-3.5" />} aria-label={`删除区域 ${index + 1}`} disabled={submitting} onClick={() => removeRegion(region.id)} />
                                </div>
                                <Input.TextArea id={`local-edit-note-${region.id}`} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={600} value={region.note} disabled={submitting} placeholder="例如：移除反光，保留原本颜色和纹理"
                                    onFocus={() => setActiveId(region.id)}
                                    onChange={(event) => {
                                        const note = event.target.value;
                                        setRegions((current) => current.map((item) => item.id === region.id ? { ...item, note } : item));
                                    }} />
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto space-y-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                        <p className="break-words">{modelLabel} · {quotaLabel}</p>
                        <p>以原尺寸生成 PNG，选区外保留原图像素。{transparentBackground && "透明背景已开启，选区内的原有透明区域也会保留。"}</p>
                        {blockReason || error ? <p role="alert" className="text-destructive">{blockReason || error}</p> : null}
                    </div>
                </section>
            </div>
        </Modal>
    );
}

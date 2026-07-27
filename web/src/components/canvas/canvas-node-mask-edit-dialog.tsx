import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal, Slider } from "antd";
import { Brush, Eraser, RotateCcw, WandSparkles, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageMaskEditPayload = {
    prompt: string;
    maskDataUrl: string;
};

type DrawMode = "paint" | "erase";

const defaultBrushSize = 100;
const maskFillColor = "#2563eb";

export function CanvasNodeMaskEditDialog({
    dataUrl,
    imageWidth,
    imageHeight,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    imageWidth?: number;
    imageHeight?: number;
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: CanvasImageMaskEditPayload) => void;
}) {
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<{ active: boolean; last: { x: number; y: number } | null }>({ active: false, last: null });
    const hasPaintRef = useRef(false);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setBrushSize(defaultBrushSize);
        setMode("paint");
        setError("");
        setSubmitting(false);
        hasPaintRef.current = false;
        setImage(validImageSize(imageWidth, imageHeight));
    }, [dataUrl, imageHeight, imageWidth, open]);

    useEffect(() => {
        if (!open || validImageSize(imageWidth, imageHeight)) return;
        let active = true;
        void readImageMeta(dataUrl).then((meta) => {
            if (active) setImage(meta);
        });
        return () => {
            active = false;
        };
    }, [dataUrl, imageHeight, imageWidth, open]);

    useEffect(() => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        hasPaintRef.current = false;
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const maskCanvas = maskCanvasRef.current;
        const maskContext = maskCanvas?.getContext("2d");
        const previewContext = previewCanvasRef.current?.getContext("2d");
        if (!maskCanvas || !maskContext || !previewContext) return;
        configureBrush(maskContext, brushSize, mode, "#000");
        configureBrush(previewContext, brushSize, mode, maskFillColor);
        if (!drawingRef.current.last) {
            drawMaskStroke(maskContext, point, point, brushSize);
            drawMaskStroke(previewContext, point, point, brushSize);
        } else {
            drawMaskStroke(maskContext, drawingRef.current.last, point, brushSize);
            drawMaskStroke(previewContext, drawingRef.current.last, point, brushSize);
        }
        drawingRef.current.last = point;
        if (mode === "paint") {
            hasPaintRef.current = true;
            setError("");
        }
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = { active: true, last: null };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = () => {
        drawingRef.current = { active: false, last: null };
    };

    const resetMask = () => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        hasPaintRef.current = false;
        setError("");
    };

    const submit = async () => {
        const nextPrompt = prompt.trim();
        const canvas = maskCanvasRef.current;
        if (!nextPrompt) return setError("请输入修改要求");
        if (!canvas) return;
        if (!hasPaintRef.current || !canvasHasPaint(canvas)) {
            hasPaintRef.current = false;
            return setError("请先涂抹局部区域");
        }
        setSubmitting(true);
        setError("");
        try {
            onConfirm({ prompt: nextPrompt, maskDataUrl: await buildEditMask(canvas) });
        } catch (error) {
            setError(error instanceof Error ? error.message : "蒙版处理失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]">
                <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10">
                    <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent select-none">
                        <img
                            src={dataUrl}
                            alt=""
                            className="block max-h-[68vh] max-w-full bg-transparent"
                            draggable={false}
                            decoding="async"
                            onLoad={(event) => setImage(renderedImageSize(event.currentTarget))}
                        />
                        {image ? (
                            <>
                                <canvas ref={maskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                <canvas
                                    ref={previewCanvasRef}
                                    width={image.width}
                                    height={image.height}
                                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-[0.38]"
                                    onPointerDown={startDraw}
                                    onPointerMove={moveDraw}
                                    onPointerUp={stopDraw}
                                    onPointerCancel={stopDraw}
                                />
                            </>
                        ) : null}
                    </div>
                </div>

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">局部遮罩编辑</h2>
                        <div className="mt-2 text-sm opacity-60">{image ? `${image.width} x ${image.height}px` : "读取中"}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type={mode === "paint" ? "primary" : "default"} icon={<Brush className="size-4" />} onClick={() => setMode("paint")}>
                            画笔
                        </Button>
                        <Button type={mode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setMode("erase")}>
                            擦除
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">笔刷大小</span>
                            <span className="font-semibold">{brushSize}px</span>
                        </div>
                        <Slider min={8} max={160} step={2} value={brushSize} onChange={setBrushSize} />
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">修改要求</div>
                        <Input.TextArea
                            rows={6}
                            value={prompt}
                            status={error && !prompt.trim() ? "error" : undefined}
                            placeholder="例如：把选中区域改成金属材质，保持原图光影"
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={resetMask}>
                            重置
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                取消
                            </Button>
                            <Button type="primary" icon={<WandSparkles className="size-4" />} loading={submitting} onClick={() => void submit()}>
                                AI 修改
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function validImageSize(width?: number, height?: number) {
    return Number.isFinite(width) && Number.isFinite(height) && (width || 0) > 0 && (height || 0) > 0 ? { width: width!, height: height! } : null;
}

function renderedImageSize(image: HTMLImageElement) {
    return validImageSize(image.naturalWidth, image.naturalHeight);
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function configureBrush(context: CanvasRenderingContext2D, size: number, mode: DrawMode, color: string) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = size;
    context.globalCompositeOperation = mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = color;
    context.fillStyle = color;
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const chunkHeight = Math.max(1, Math.floor(1_048_576 / Math.max(1, canvas.width)));
    for (let y = 0; y < canvas.height; y += chunkHeight) {
        const data = context.getImageData(0, y, canvas.width, Math.min(chunkHeight, canvas.height - y)).data;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 0) return true;
        }
    }
    return false;
}

async function buildEditMask(selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建编辑蒙版");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "destination-out";
    context.drawImage(selectionCanvas, 0, 0);
    try {
        return await blobToDataUrl(await canvasToBlob(canvas));
    } finally {
        canvas.width = 1;
        canvas.height = 1;
    }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("编辑蒙版编码失败"))), "image/png");
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("编辑蒙版读取失败"));
        reader.readAsDataURL(blob);
    });
}

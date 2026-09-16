import { useEffect, useRef, useState } from "react";
import { Alert, Button, InputNumber, Modal, Slider, Spin } from "antd";
import type { CanvasNodeData } from "@/types/canvas";
import { resolveMediaUrl } from "@/services/file-storage";
import { fetchServerResource } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { assertMediaDuration, captureVideoFrame, extractMediaAudio, MEDIA_LIMITS, readLimitedMedia, validateTrim } from "@/lib/canvas/canvas-media-tools";

export type CanvasMediaToolsDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onResult: (file: File, kind: "image" | "audio", signal: AbortSignal) => void | Promise<void>;
};

export function CanvasMediaToolsDialog({ node, open, onClose, onResult }: CanvasMediaToolsDialogProps) {
    const userId = useUserStore((state) => state.user?.id || "");
    const [source, setSource] = useState<{ blob: Blob; url: string } | null>(null);
    const [duration, setDuration] = useState(0);
    const [time, setTime] = useState(0);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(0);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const operation = useRef<AbortController | null>(null);
    const loadingController = useRef<AbortController | null>(null);
    const player = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
    const previewing = useRef(false);
    const isVideo = node?.type === "video";

    useEffect(() => {
        setSource(null);
        setDuration(0);
        setTime(0);
        setStart(0);
        setEnd(0);
        setError("");
        setBusy(false);
        if (!open || !node) return;
        const controller = new AbortController();
        loadingController.current = controller;
        let url = "";
        const timeout = setTimeout(() => controller.abort(new Error("媒体加载超时")), MEDIA_LIMITS.operationTimeout);
        setLoading(true);
        void (async () => {
            if (node.type !== "video" && node.type !== "audio") throw new Error("请选择视频或音频节点");
            const resolved = await resolveMediaUrl(node.metadata?.storageKey, node.metadata?.content);
            controller.signal.throwIfAborted();
            if (!resolved) throw new Error("节点没有可用的媒体资源");
            const response = await fetchServerResource(resolved, { signal: controller.signal }, userId);
            const blob = await readLimitedMedia(response, controller.signal);
            controller.signal.throwIfAborted();
            url = URL.createObjectURL(blob);
            setSource({ blob, url });
        })()
            .catch((reason: unknown) => {
                if (!controller.signal.aborted || (controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setError(reason instanceof Error ? reason.message : "媒体加载失败");
            })
            .finally(() => {
                clearTimeout(timeout);
                if (loadingController.current === controller) setLoading(false);
            });
        return () => {
            controller.abort();
            operation.current?.abort();
            operation.current = null;
            if (loadingController.current === controller) loadingController.current = null;
            clearTimeout(timeout);
            previewing.current = false;
            player.current?.pause();
            if (url) URL.revokeObjectURL(url);
        };
    }, [open, node?.id, node?.metadata?.storageKey, node?.metadata?.content, userId]);

    const cancel = () => {
        loadingController.current?.abort();
        operation.current?.abort();
        player.current?.pause();
        previewing.current = false;
        setLoading(false);
        setError("已取消");
    };
    const close = () => {
        cancel();
        onClose();
    };
    const run = async (kind: "image" | "audio", action: (signal: AbortSignal) => Promise<File>) => {
        if (operation.current || !source) return;
        const controller = new AbortController();
        operation.current = controller;
        const timeout = setTimeout(() => controller.abort(new Error("媒体处理超时，请缩短素材后重试")), MEDIA_LIMITS.operationTimeout);
        setBusy(true);
        setError("");
        player.current?.pause();
        previewing.current = false;
        try {
            const file = await action(controller.signal);
            controller.signal.throwIfAborted();
            await onResult(file, kind, controller.signal);
        } catch (reason) {
            if (operation.current === controller)
                setError(controller.signal.aborted ? (controller.signal.reason?.name === "AbortError" ? "已取消" : controller.signal.reason?.message || "已取消") : reason instanceof Error ? reason.message : "媒体处理失败");
        } finally {
            clearTimeout(timeout);
            if (operation.current === controller) {
                operation.current = null;
                setBusy(false);
            }
        }
    };
    const seek = (value: number) => {
        setTime(value);
        if (player.current) player.current.currentTime = Math.min(value, Math.max(0, duration - 0.001));
    };
    const preview = async () => {
        try {
            validateTrim({ start, end }, duration);
            if (!player.current) return;
            player.current.currentTime = start;
            previewing.current = true;
            await player.current.play();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "无法试听");
        }
    };
    const mediaProps = {
        src: source?.url,
        controls: true,
        preload: "metadata",
        onLoadedMetadata: () => {
            try {
                const value = player.current?.duration || 0;
                assertMediaDuration(value);
                setDuration(value);
                setEnd(value);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : "媒体时长无效");
            }
        },
        onTimeUpdate: () => {
            const value = player.current?.currentTime || 0;
            setTime(value);
            if (previewing.current && value >= end) {
                player.current?.pause();
                previewing.current = false;
            }
        },
        onError: () => setError("无法预览该媒体，请检查文件格式"),
    };
    const disabled = busy || loading || !source || !duration;
    return (
        <Modal
            title={isVideo ? "视频工具" : "音频裁剪"}
            open={open}
            onCancel={close}
            footer={
                <Button type="text" onClick={close}>
                    关闭
                </Button>
            }
            width={640}
            destroyOnHidden
        >
            <div className="flex flex-col gap-4">
                <p className="m-0 opacity-65">生成新素材，保留原文件。输入上限 200 MiB / 10 分钟，单次处理最多 2 分钟。</p>
                {error && <Alert type="error" title={error} showIcon />}
                {loading && <Spin description="正在读取媒体…" />}
                {source &&
                    (isVideo ? (
                        <video
                            {...mediaProps}
                            ref={(element) => {
                                player.current = element;
                            }}
                            className="max-h-72 w-full"
                        />
                    ) : (
                        <audio
                            {...mediaProps}
                            ref={(element) => {
                                player.current = element;
                            }}
                            className="w-full"
                        />
                    ))}
                {isVideo ? (
                    <>
                        <label>
                            截帧时间：{time.toFixed(2)} / {duration.toFixed(2)} 秒
                        </label>
                        <Slider aria-label="截帧时间" min={0} max={duration || 1} step={0.01} value={time} onChange={seek} disabled={disabled} />
                        <div className="flex flex-wrap gap-2">
                            {(
                                [
                                    ["first", "截取首帧"],
                                    ["current", "截取当前帧"],
                                    ["last", "截取尾帧"],
                                ] as const
                            ).map(([position, label]) => (
                                <Button type="text" key={position} disabled={disabled} onClick={() => void run("image", (signal) => captureVideoFrame(source!.blob, position, player.current?.currentTime ?? time, signal))}>
                                    {label}
                                </Button>
                            ))}
                            <Button type="text" disabled={disabled} onClick={() => void run("audio", (signal) => extractMediaAudio(source!.blob, undefined, signal))}>
                                提取音频（WAV）
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex flex-wrap gap-4">
                            <label>
                                开始（秒）
                                <InputNumber
                                    aria-label="开始秒数"
                                    min={0}
                                    max={duration}
                                    step={0.1}
                                    value={start}
                                    onChange={(value) => {
                                        previewing.current = false;
                                        player.current?.pause();
                                        setStart(value ?? 0);
                                    }}
                                    disabled={disabled}
                                />
                            </label>
                            <label>
                                结束（秒）
                                <InputNumber
                                    aria-label="结束秒数"
                                    min={0}
                                    max={duration}
                                    step={0.1}
                                    value={end}
                                    onChange={(value) => {
                                        previewing.current = false;
                                        player.current?.pause();
                                        setEnd(value ?? 0);
                                    }}
                                    disabled={disabled}
                                />
                            </label>
                        </div>
                        <p className="m-0 opacity-65">至少保留 0.5 秒；试听到结束时间自动停止。</p>
                        <div className="flex flex-wrap gap-2">
                            <Button type="text" disabled={disabled} onClick={() => void preview()}>
                                试听选段
                            </Button>
                            <Button type="text" disabled={disabled} onClick={() => void run("audio", (signal) => extractMediaAudio(source!.blob, validateTrim({ start, end }, duration), signal))}>
                                生成裁剪音频（WAV）
                            </Button>
                        </div>
                    </>
                )}
                {(busy || loading) && (
                    <Button type="text" onClick={cancel}>
                        取消处理
                    </Button>
                )}
                {busy && <span role="status">正在处理，请稍候…</span>}
            </div>
        </Modal>
    );
}

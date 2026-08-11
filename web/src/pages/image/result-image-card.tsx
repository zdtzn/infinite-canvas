import { Button, Image, Tooltip } from "antd";
import { Download, FolderPlus, ImagePlus, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { formatBytes, formatDuration } from "@/lib/image-utils";
import type { GeneratedImage } from "@/services/image-generation-runtime";

const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";

export function ResultImageCard({
    image,
    index,
    savingAsset,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    savingAsset: boolean;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const [previewStatus, setPreviewStatus] = useState<"loading" | "loaded" | "error">("loading");
    const [previewAttempt, setPreviewAttempt] = useState(0);
    const recoveryPending = image.persisted === false;
    const previewImageUrl = image.thumbnailUrl || image.dataUrl;

    useEffect(() => {
        setPreviewStatus("loading");
        setPreviewAttempt(0);
    }, [image.dataUrl]);

    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="relative aspect-square overflow-hidden bg-stone-100 dark:bg-stone-900">
                {previewStatus !== "loaded" ? (
                    <div className="absolute inset-0 z-10 grid place-items-center p-4 text-center" aria-live="polite">
                        {previewStatus === "error" ? (
                            <div className="space-y-2">
                                <div className="text-sm text-stone-500 dark:text-stone-400">高清预览加载失败</div>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setPreviewStatus("loading");
                                        setPreviewAttempt((attempt) => attempt + 1);
                                    }}
                                >
                                    重新加载预览
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                                <LoaderCircle className="size-4 animate-spin" />
                                正在载入高清预览
                            </div>
                        )}
                    </div>
                ) : null}
                <Image
                    key={`${image.id}:${previewAttempt}`}
                    src={retryImageUrl(previewImageUrl, previewAttempt)}
                    alt={`生成结果 ${index + 1}`}
                    rootClassName="block size-full"
                    className={`size-full object-contain transition-opacity duration-200 ${previewStatus === "loaded" ? "opacity-100" : "opacity-0"}`}
                    style={{ width: "100%", height: "100%" }}
                    loading="eager"
                    decoding="async"
                    fetchPriority={index === 0 ? "high" : "auto"}
                    preview={previewStatus === "loaded" ? { src: image.dataUrl } : false}
                    onLoad={() => setPreviewStatus("loaded")}
                    onError={() => setPreviewStatus("error")}
                />
            </div>
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    {image.bytes ? <span>{formatBytes(image.bytes)}</span> : null}
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={recoveryPending ? "图片处理中，请稍候" : "入藏卷阁"}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} loading={savingAsset} disabled={savingAsset || recoveryPending} onClick={() => void onSaveAsset(image, index)}>
                            入藏卷阁
                        </Button>
                    </Tooltip>
                    <Tooltip title={recoveryPending ? "图片处理中，请稍候" : "加入参考图"}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<ImagePlus className="size-3.5" />} disabled={recoveryPending} onClick={() => void onEdit(image, index)}>
                            加入参考图
                        </Button>
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(image, index)}>
                            下载
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function retryImageUrl(url: string, attempt: number) {
    if (!attempt || !url.startsWith("/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}previewRetry=${attempt}`;
}

import { Button } from "antd";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { IMAGE_RECONNECT_NOTICE, imageGenerationProgressLabel } from "@/lib/image-generation-progress";
import type { GenerationResult } from "@/services/image-generation-runtime";

export function PendingImageCard({ result, onCancel }: { result: GenerationResult; onCancel: () => void }) {
    const [failedPreviewUrl, setFailedPreviewUrl] = useState<string>();
    const preview = result.progress?.previewImage;
    const previewUrl = preview?.recoveryUrl || preview?.dataUrl;
    const showPreview = !!previewUrl && previewUrl !== failedPreviewUrl;
    return (
        <div className={showPreview ? "overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" : "relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900"}>
            {showPreview ? (
                <img src={previewUrl} onError={() => setFailedPreviewUrl(previewUrl)} alt="生成预览" className="aspect-square w-full object-contain" loading="eager" decoding="async" fetchPriority="high" />
            ) : (
                <div
                    className="absolute inset-0 opacity-60"
                    style={{
                        backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                        backgroundSize: "16px 16px",
                    }}
                />
            )}
            <div className={`${showPreview ? "border-t border-stone-200 dark:border-stone-800" : "absolute inset-0"} flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-stone-500 dark:text-stone-400`}>
                <LoaderCircle className={`${showPreview ? "size-4" : "size-6"} animate-spin`} />
                <span role="status">{result.cancelRequested ? "正在取消…" : imageGenerationProgressLabel(result.progress, result.startedAt ? "生成中" : "排队中")}</span>
                {result.progress?.reconnecting ? <p role="status" className="text-xs">{IMAGE_RECONNECT_NOTICE}</p> : null}
                {result.cancelError ? (
                    <details className="w-full min-w-0 text-xs">
                        <summary className="min-h-11 cursor-pointer py-1">
                            <span role="alert" className="text-red-500">取消未成功，任务仍在继续，请稍后重试</span>
                            <span className="ml-1">查看详情</span>
                        </summary>
                        <p className="max-h-24 overflow-y-auto break-words whitespace-pre-wrap text-left">{result.cancelError}</p>
                    </details>
                ) : null}
                <Button onClick={onCancel} disabled={result.cancelRequested}>
                    {result.cancelRequested ? "正在取消" : "取消这张"}
                </Button>
            </div>
        </div>
    );
}

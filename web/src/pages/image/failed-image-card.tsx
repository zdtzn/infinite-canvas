import { Button } from "antd";
import { ImageOff, RotateCcw } from "lucide-react";

import { generationFailureFeedback } from "@/features/cultivation/generation-messages";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function FailedImageCard({ id, error, isDouEmperor, onRetry }: { id: string; error?: string; isDouEmperor: boolean; onRetry: () => void }) {
    const feedback = generationFailureFeedback(error, { isDouEmperor, seed: `${id}:${error || ""}` });
    const errorDetail = friendlyErrorMessage(error);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="flex min-h-72 flex-col overflow-hidden rounded-lg border" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
                <ImageOff className="size-7" style={{ color: theme.node.faint }} aria-hidden="true" />
                <div className="max-w-xs" role="status">
                    <h3 className="text-base font-medium">{isDouEmperor ? "这一笔未能成卷" : "这张图没能生成"}</h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{feedback.description}</p>
                </div>
                <Button className="!min-h-11 !min-w-32" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
                    再试一次
                </Button>
                {error ? (
                    <details className="w-full max-w-xs text-left text-xs" style={{ color: theme.node.muted }}>
                        <summary className="min-h-11 cursor-pointer select-none py-3 text-center">查看详情</summary>
                        <p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap leading-5 select-text">{errorDetail}</p>
                    </details>
                ) : null}
            </div>
        </div>
    );
}

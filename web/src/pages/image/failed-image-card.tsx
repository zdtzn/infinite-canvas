import { Button, Typography } from "antd";

import { generationFailureFeedback } from "@/features/cultivation/generation-messages";
import { friendlyErrorMessage } from "@/lib/friendly-error";

export function FailedImageCard({ id, error, isDouEmperor, onRetry }: { id: string; error?: string; isDouEmperor: boolean; onRetry: () => void }) {
    const feedback = generationFailureFeedback(error, { isDouEmperor, seed: `${id}:${error || ""}` });
    const errorDetail = friendlyErrorMessage(error);

    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{feedback.title}</div>
                <Typography.Paragraph ellipsis={{ rows: 2 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {feedback.description}
                </Typography.Paragraph>
                <Typography.Paragraph ellipsis={{ rows: 3 }} className="!mb-0 max-w-full rounded-md bg-red-100/70 px-3 py-2 !text-xs !leading-5 !text-red-700 dark:bg-red-950/50 dark:!text-red-200">
                    {errorDetail}
                </Typography.Paragraph>
                {feedback.reference ? <div className="text-[11px] text-red-400 dark:text-red-400">{feedback.reference}</div> : null}
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
                </Button>
            </div>
        </div>
    );
}

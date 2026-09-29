import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { formatDuration } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { IMAGE_RECONNECT_NOTICE, imageGenerationProgressLabel } from "@/lib/image-generation-progress";
import type { ServerJobProgress } from "@/services/server-api";

export function ImageGenerationPending({ className, label, progress, compact = false }: { className?: string; label?: string; progress?: ServerJobProgress; compact?: boolean }) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, []);

    return (
        <div className={cn("relative overflow-hidden bg-stone-100 dark:bg-white/10", compact ? "min-h-24" : "aspect-[4/3]", className)}>
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                    maskImage: "radial-gradient(ellipse at 38% 68%, black 0%, black 28%, transparent 60%)",
                }}
            />
            <div className="absolute left-4 top-4 flex items-center gap-2 text-[15px] font-medium text-stone-500 dark:text-stone-300">
                <LoaderCircle className="size-4 animate-spin" />
                <span role="status">{progress ? imageGenerationProgressLabel(progress) : label || "生成中"}</span>
            </div>
            <div className="absolute bottom-4 left-4 right-4">
                <div className="mb-2 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                    <span>{formatDuration(tick * 1000)}</span>
                </div>
                {progress?.reconnecting ? <p role="status" className="text-xs text-stone-500 dark:text-stone-400">{IMAGE_RECONNECT_NOTICE}</p> : null}
            </div>
        </div>
    );
}

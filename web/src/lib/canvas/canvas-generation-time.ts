import { formatDuration } from "@/lib/image-utils";

export function formatCanvasGenerationElapsed(startedAt: number, now = Date.now()) {
    const safeStartedAt = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : now;
    return `已等待 ${formatDuration(Math.max(0, now - safeStartedAt))}`;
}

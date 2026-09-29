import type { ServerJobProgress } from "@/services/server-api";

export const IMAGE_RECONNECT_NOTICE = "连接暂时中断，正在重新连接；任务已保留，无需重新提交。";

export function imageGenerationProgressLabel(progress?: ServerJobProgress, fallback = "生成中") {
    if (progress?.reconnecting) return "重新连接中";
    switch (progress?.phase) {
        case "queued": return "排队中";
        case "submitting": return "提交中";
        case "waiting_upstream": return "生成中";
        case "persisting": return "正在传输并保存图片";
        case "completed": return "生成完成";
        default: return fallback;
    }
}

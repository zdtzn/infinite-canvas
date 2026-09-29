import type { GenerationResult } from "@/services/image-generation-runtime";

export function summarizeImageTasks(results: GenerationResult[]) {
    const counts = { generating: 0, queued: 0, submitting: 0, reconnecting: 0, persisting: 0, completed: 0, saving: 0, canceling: 0, success: 0, failed: 0, canceled: 0 };
    for (const result of results) {
        if (result.status === "pending") {
            counts[result.cancelRequested ? "canceling" : result.progress?.reconnecting ? "reconnecting" : result.progress?.phase === "queued" ? "queued" : result.progress?.phase === "submitting" ? "submitting" : result.progress?.phase === "persisting" ? "persisting" : result.progress?.phase === "completed" ? "completed" : result.startedAt ? "generating" : "queued"]++;
        } else if (result.status === "success" && result.image?.persisted === false) {
            counts.saving++;
        } else {
            counts[result.status]++;
        }
    }
    const active = [["生成中", counts.generating], ["排队中", counts.queued], ["提交中", counts.submitting], ["重新连接中", counts.reconnecting], ["正在传输并保存图片", counts.persisting], ["生成完成", counts.completed], ["保存中", counts.saving], ["取消中", counts.canceling]] as const;
    const settled = [["成功", counts.success], ["失败", counts.failed], ["已取消", counts.canceled]] as const;
    const describe = (entries: readonly (readonly [string, number])[]) => entries.filter(([, count]) => count).map(([label, count]) => `${label} ${count} 张`).join(" · ");
    return {
        activeText: describe(active),
        text: describe([...active, ...settled]),
        settled: counts.success + counts.saving + counts.failed + counts.canceled,
        total: results.length,
    };
}

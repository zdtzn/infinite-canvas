import type { GenerationResult } from "@/services/image-generation-runtime";

export function summarizeImageTasks(results: GenerationResult[]) {
    const counts = { generating: 0, queued: 0, canceling: 0, success: 0, failed: 0, canceled: 0 };
    for (const result of results) {
        if (result.status === "pending") {
            counts[result.cancelRequested ? "canceling" : result.startedAt ? "generating" : "queued"]++;
        } else {
            counts[result.status]++;
        }
    }
    const active = [["生成中", counts.generating], ["排队中", counts.queued], ["取消中", counts.canceling]] as const;
    const settled = [["成功", counts.success], ["失败", counts.failed], ["已取消", counts.canceled]] as const;
    const describe = (entries: readonly (readonly [string, number])[]) => entries.filter(([, count]) => count).map(([label, count]) => `${label} ${count} 张`).join(" · ");
    return {
        activeText: describe(active),
        text: describe([...active, ...settled]),
        settled: counts.success + counts.failed + counts.canceled,
        total: results.length,
    };
}

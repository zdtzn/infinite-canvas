type ImageHistorySummaryInput = {
    successCount?: number;
    failCount?: number;
    imageCount?: number;
    config?: { count?: string | number };
    status?: "成功" | "失败";
    images?: readonly unknown[];
};

export function imageHistorySummary(log: ImageHistorySummaryInput) {
    const imageCount = log.images?.length || 0;
    const configuredCount = Number(log.config?.count) || 0;
    const successCount = Math.max(log.successCount ?? (imageCount || (log.status === "失败" ? 0 : log.imageCount || configuredCount)), imageCount);
    const totalCount = Math.max(configuredCount, log.imageCount || 0, successCount + (log.failCount || 0), imageCount, 1);
    const failCount = log.failCount ?? totalCount - successCount;
    const outcome = !successCount ? "failure" : failCount || successCount < totalCount ? "partial" : "success";
    const status = outcome === "partial" ? "部分成功" : outcome === "success" ? "成功" : "失败";

    return { outcome, label: `${status} · ${successCount}/${totalCount}张`, successCount, failCount, totalCount, retryCount: totalCount };
}

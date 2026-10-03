import { serverRequest } from "./server-api";
import { performanceRoute } from "@/lib/performance-telemetry";

export const PERFORMANCE_METRIC_TITLES: Record<string, string> = {
    route_ready: "路由提交就绪", document_ready: "文档就绪", ttfb: "首字节响应",
    lcp: "初始文档 LCP", event_interaction_latency: "交互事件延迟（窗口最大值）",
    image_job_queue: "图片 · 排队", image_job_upstream: "图片 · 上游",
    image_job_persistence: "图片 · 结果处理", image_job_total: "图片 · 执行总耗时", image_job_outcome: "图片 · 终态次数",
};

export type PerformanceSeries = {
    route: string;
    name: string;
    unit: "ms" | "count";
    outcome: "observed" | "succeeded" | "failed" | "canceled";
    count: number;
    p50UpperMs: number | null;
    p95UpperMs: number | null;
    buckets: { upperMs: number | null; count: number }[];
};
export type PerformanceSnapshot = { since: string; lifetime: "process"; series: PerformanceSeries[] };

export async function fetchPerformanceMetrics(signal?: AbortSignal, expectedUserId?: string): Promise<PerformanceSnapshot> {
    const data = await serverRequest<PerformanceSnapshot>("/api/admin/performance", { signal, expectedUserId, timeoutMs: 12000, cache: "no-store" });
    const bound = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (!data || data.lifetime !== "process" || typeof data.since !== "string" || !Number.isFinite(Date.parse(data.since)) ||
        // 16 fixed routes × 5 frontend metrics + 5 image metrics × 3 outcomes.
        !Array.isArray(data.series) || data.series.length > 95 || data.series.some((row) => !row || typeof row.route !== "string" || performanceRoute(row.route) !== row.route ||
            typeof row.name !== "string" || !Object.hasOwn(PERFORMANCE_METRIC_TITLES, row.name) || row.unit !== (row.name === "image_job_outcome" ? "count" : "ms") ||
            !["observed", "succeeded", "failed", "canceled"].includes(row.outcome) || !Number.isSafeInteger(row.count) || row.count < 0 ||
            !bound(row.p50UpperMs) || !bound(row.p95UpperMs) || !Array.isArray(row.buckets) || row.buckets.length > 15 ||
            row.buckets.some((bucket) => !bucket || !bound(bucket.upperMs) || !Number.isSafeInteger(bucket.count) || bucket.count < 0))) throw new Error("性能统计响应格式无效，请稍后重试");
    return data;
}

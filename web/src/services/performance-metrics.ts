import { serverRequest } from "./server-api";

export type PerformanceSeries = {
    route: string;
    name: string;
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
        !Array.isArray(data.series) || data.series.length > 63 || data.series.some((row) => !row || typeof row.route !== "string" || typeof row.name !== "string" ||
            !["observed", "succeeded", "failed", "canceled"].includes(row.outcome) || !Number.isSafeInteger(row.count) || row.count < 0 ||
            !bound(row.p50UpperMs) || !bound(row.p95UpperMs))) throw new Error("性能统计响应格式无效，请稍后重试");
    return data;
}

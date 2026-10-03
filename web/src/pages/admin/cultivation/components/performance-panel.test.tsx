import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { useUserStore } from "@/stores/use-user-store";
import type { PerformanceSnapshot } from "@/services/performance-metrics";
import { PerformancePanel } from "./performance-panel";

const key = ["admin", "performance", "admin-test"];
function render(client: QueryClient, admin = true) {
    const initial = useUserStore.getInitialState();
    const previous = initial.user;
    initial.user = { id: "admin-test", username: "admin", displayName: "管理", avatarUrl: "", admin };
    try { return renderToStaticMarkup(<QueryClientProvider client={client}><PerformancePanel /></QueryClientProvider>); }
    finally { initial.user = previous; }
}

test("unloaded panel is demand-only and query overrides global polling/retry defaults", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, refetchInterval: 1000, throwOnError: true } } });
    try {
        const html = render(client);
        expect(html).toContain("加载性能统计");
        expect(html).toContain("尚未加载");
        expect(html).toContain("不是精确分位数");
        const options = client.getQueryCache().find({ queryKey: key })?.options as Record<string, unknown>;
        expect(options.enabled).toBe(false);
        expect(options.refetchInterval).toBe(false);
        expect(options.refetchOnWindowFocus).toBe(false);
        expect(options.refetchOnReconnect).toBe(false);
        expect(options.retry).toBe(false);
        expect(options.throwOnError).toBe(false);
        expect(client.isFetching()).toBe(0);
    } finally { client.clear(); }
});

test("shows process start, counts, outcomes and overflow; hides meaningless outcome percentiles", () => {
    const client = new QueryClient();
    const row = { route: "/image", name: "image_job_total", unit: "ms" as const, outcome: "failed" as const, count: 23, p50UpperMs: 1000, p95UpperMs: null, buckets: [] };
    client.setQueryData<PerformanceSnapshot>(key, { since: "2026-09-29T00:00:00.000Z", lifetime: "process", series: [row, { ...row, name: "image_job_outcome", unit: "count", outcome: "canceled" }] });
    try {
        const html = render(client);
        for (const text of ["进程统计起点", "2026-09-29T00:00:00.000Z", "P50 桶上界", "P95 桶上界", "23", "失败", "已取消", "≤ 1,000 ms", "300,000 ms（溢出桶）", "不适用"]) expect(html).toContain(text);
        expect(render(client, false)).toBe("");
    } finally { client.clear(); }
});

test("names perceived metrics honestly with units and sampling/SPA limitations", () => {
    const client = new QueryClient();
    const row = { route: "/canvas/:id", outcome: "observed" as const, unit: "ms" as const, count: 1, buckets: [] };
    client.setQueryData<PerformanceSnapshot>(key, { since: "2026-09-29T00:00:00.000Z", lifetime: "process", series: [
        { ...row, name: "lcp", p50UpperMs: 2500, p95UpperMs: 4000 },
        { ...row, name: "event_interaction_latency", p50UpperMs: 200, p95UpperMs: 500 },
        { ...row, name: "route_ready", p50UpperMs: 50, p95UpperMs: 100 },
    ] });
    try {
        const html = render(client);
        for (const text of ["初始文档 LCP", "交互事件延迟（窗口最大值）", "路由提交就绪", "单位", "≤ 2,500 ms", "≤ 200 ms", "这不是 INP", "文档初始路由", "≥ 16 ms", "不代表全部交互次数", "不补报 LCP"]) expect(html).toContain(text);
        expect(html).not.toContain("页面就绪（route_ready）");
    } finally { client.clear(); }
});

test("failed refresh keeps snapshot and provides inline recovery without throwing", () => {
    const client = new QueryClient();
    client.setQueryData(key, { since: "2026-09-29T00:00:00.000Z", lifetime: "process", series: [] });
    client.getQueryCache().find({ queryKey: key })!.setState({ status: "error", error: new Error("offline") });
    try {
        const html = render(client);
        expect(html).toContain('role="alert"');
        expect(html).toContain("重试加载");
        expect(html).toContain("下方保留上次快照，可能已过期");
        expect(html).toContain("当前进程暂无性能样本");
    } finally { client.clear(); }
});

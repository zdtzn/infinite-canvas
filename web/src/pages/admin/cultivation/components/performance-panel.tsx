import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Table } from "antd";
import { RefreshCw } from "lucide-react";
import { fetchPerformanceMetrics, PERFORMANCE_METRIC_TITLES, type PerformanceSeries } from "@/services/performance-metrics";
import { useUserStore } from "@/stores/use-user-store";

const outcomes = { observed: "已采样", succeeded: "成功", failed: "失败", canceled: "已取消" };

function upperBound(value: number | null, row: PerformanceSeries) {
    if (row.unit === "count" || row.count === 0) return "不适用";
    return value === null ? "> 300,000 ms（溢出桶）" : `≤ ${value.toLocaleString()} ms`;
}

export function PerformancePanel() {
    const user = useUserStore((state) => state.user);
    const metrics = useQuery({
        queryKey: ["admin", "performance", user?.id],
        queryFn: ({ signal }) => fetchPerformanceMetrics(signal, user?.id),
        enabled: false,
        retry: false,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        throwOnError: false,
        gcTime: 0,
    });
    if (!user?.admin) return null;
    return (
        <section className="cultivation-admin-panel" aria-label="私有性能统计" aria-busy={metrics.isFetching}>
            <div className="cultivation-admin-panel-header flex-wrap gap-3">
                <div>
                    <h2>性能统计</h2>
                    <p>仅管理员可见 · 点击加载或刷新，不自动轮询。</p>
                </div>
                <Button loading={metrics.isFetching} icon={<RefreshCw className="size-4" aria-hidden="true" />} onClick={() => void metrics.refetch()}>
                    {metrics.isError ? "重试加载" : metrics.data ? "刷新性能统计" : "加载性能统计"}
                </Button>
            </div>
            <div className="space-y-2 px-5 pb-4 text-sm text-muted-foreground">
                <p>统计范围：当前服务进程累计，重启清零，各实例独立统计。</p>
                <p>P50 / P95 为直方图桶上界，不是精确分位数。溢出桶表示超过 300 秒。</p>
                <p>路由提交就绪（route_ready）测量界面提交后两帧，不代表图片、数据加载完成或 LCP。</p>
                <p>初始文档 LCP（ms）记录首次输入、隐藏或站内切页前的最大内容绘制时间，始终归属文档初始路由；站内切页不生成新的 LCP。</p>
                <p>交互事件延迟（ms）为每个约 6 秒活跃采样窗口内最慢的交互事件耗时，包含输入等待、处理和后续绘制；切页或隐藏会提前结束窗口。这不是 INP，仅观测 ≥ 16 ms 的事件，不代表全部交互次数。</p>
                <p>仅支持相应浏览器接口的前台页面参与感知性能采样；无样本不代表耗时为零。后台加载、预渲染与缓存恢复不补报 LCP。采样限流时合并待发送窗口并保留最大值。</p>
                <p>各阶段样本可能来自同一任务，请勿相加作为任务总数；终态次数仅计数，不展示耗时分位数。</p>
                {metrics.data ? <p>进程统计起点：<time dateTime={metrics.data.since}>{new Date(metrics.data.since).toLocaleString("zh-CN", { hour12: false })}</time></p> : null}
                {metrics.dataUpdatedAt ? <p>快照读取时间：{new Date(metrics.dataUpdatedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
                {metrics.isError ? <p role="alert">性能统计加载失败，请点击重试。{metrics.data ? "下方保留上次快照，可能已过期。" : "其他系统信息仍可正常查看。"}</p> : null}
                {metrics.isFetching ? <p role="status">正在读取性能统计…</p> : null}
            </div>
            {metrics.data ? (
                <Table<PerformanceSeries>
                    className="cultivation-admin-table"
                    rowKey={(row) => `${row.route}:${row.name}:${row.outcome}`}
                    dataSource={metrics.data.series}
                    size="middle"
                    scroll={{ x: 850 }}
                    pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前进程暂无性能样本" /> }}
                    columns={[
                        { title: "路由", dataIndex: "route", width: 180 },
                        { title: "指标", dataIndex: "name", width: 220, render: (name: string) => PERFORMANCE_METRIC_TITLES[name] || name },
                        { title: "单位", dataIndex: "unit", width: 80, render: (unit: PerformanceSeries["unit"]) => unit === "count" ? "次" : "ms" },
                        { title: "结果", dataIndex: "outcome", width: 100, render: (outcome: PerformanceSeries["outcome"]) => outcomes[outcome] },
                        { title: "样本数 / 次数", dataIndex: "count", width: 120, align: "right", render: (count: number) => count.toLocaleString() },
                        { title: "P50 桶上界", dataIndex: "p50UpperMs", width: 180, align: "right", render: upperBound },
                        { title: "P95 桶上界", dataIndex: "p95UpperMs", width: 180, align: "right", render: upperBound },
                    ]}
                />
            ) : !metrics.isFetching && !metrics.isError ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未加载，点击上方按钮查看性能统计" /> : null}
        </section>
    );
}

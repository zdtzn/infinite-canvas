# 私有性能监测

用于回答：页面就绪是否变慢？图片任务耗时集中在排队、上游还是结果处理？失败和取消是否增加？

## 接口和隐私

`POST /api/performance` 复用登录和同源校验，额外按用户限制每分钟 12 次（含无效请求尝试，不按 IP 分割）。内存限流表最多 10000 个活跃用户；满时拒绝新键，不能通过挤出旧键绕过限流。请求最多 2048 字节，必须为 `{samples:[{route,name,durationMs}]}`，1–3 项，拒绝额外字段。`durationMs` 必须是 0–300000 的有限数字。成功返回 204；格式错误 400、未登录 401、跨站 403、超体积 413、限流 429。

`name` 仅允许 `route_ready`、`document_ready`、`ttfb`。`route` 仅允许 `/`、`/canvas`、`/canvas/:id`、`/chat`、`/image`、`/color-alchemy`、`/wallet`、`/cultivation`、`/prompts`、`/assets`、`/video`、`/announcements`、`/config`、`/docs`、`/admin/cultivation`、`/other`。客户端必须先映射为模板；原始路径、查询参数和 URL 不被接收。

每批只产生一条 `frontend_performance` JSON 日志，字段为服务器生成的 `requestId` 和经过校验的 `samples`。不包含用户、提示词、URL、令牌或请求原文。用户 ID 仅用于内存限流，不进入指标或采样日志；指标无需同步文件 IO 或数据库写入。

`GET /api/admin/performance` 必须管理员登录，返回 `{since,lifetime:"process",series:[{route,name,outcome,count,p50UpperMs,p95UpperMs,buckets:[{upperMs,count}]}]}`，响应 `Cache-Control: private, no-store`。`since` 是进程指标实例初始化的 ISO 时间；没有公开读接口。

## 口径与边界

每个进程独立累计，重启清零，没有跨实例汇总或滑动时间窗口。最多 48 个前端序列和 15 个图片序列。每个序列固定 13 桶，无原始样本、用户或任务 ID。桶上界（毫秒）：50、100、250、500、1000、2000、5000、10000、30000、60000、120000、300000、无穷大。`buckets.count` 为非累计计数；`upperMs: null` 是溢出桶。分位数是最近秩对应的桶上界，并非精确延迟；`p50UpperMs` 或 `p95UpperMs` 为 null 表示该分位数超过最大有限桶。

前端 `outcome` 为 `observed`，由客户端上报，仅用于趋势诊断，不作为安全审计、计费或 SLO 的唯一依据。不要盲目重试失败采样。

客户端仅在公网模式、已登录且页面可见时尝试发送；每个标签页至少间隔 6 秒、生命周期最多 60 批，每批最多 3 项。请求 3 秒超时、无重试、无持久队列、不发送 Referer，失败不影响界面。快速切换或后台标签页会漏采，这是控制开销的取舍，并非全量访问统计。

`route_ready` 从路由包装层挂载到懒加载内容提交后两帧，不含此前鉴权与首屏 JS 下载，也不保证图片和接口数据已全部就绪；`document_ready` 是初始文档的 DOMContentLoaded 耗时，`ttfb` 是初始文档首字节耗时，二者归属初始文档路由。不要把这些指标标为 LCP 或直接相加。

管理员可在掌教殿系统页点击“加载性能统计”；面板仅手动读取快照，不新增定时轮询。加载失败保留上次快照并标示过期风险。

图片复用 `image_job_timing` 的时间点，序列为 `image_job_queue`、`image_job_upstream`、`image_job_persistence`、`image_job_total`，按 `succeeded` / `failed` / `canceled` 分开。`total` 延续原口径，从 worker 开始计算，不含 queue；upstream 包含渠道调度和输入准备；persistence 包含返回后的结果处理和结算，可能只生成延后下载引用，并不保证已落盘。未到达结果处理的失败不产生 persistence 序列。worker finally 记录已执行阶段耗时和原有 timing 日志；不会记录图片、提示词或 URL。

`image_job_outcome` 是终态次数，duration 为 0（其分位数无业务含义）；包含未开始执行就取消或初始化失败的任务，终态重复通知不重复计数。已恢复的历史终态不回灌。运行中取消的终态计数可早于 worker 退出后的 timing，进程崩溃时尚未完成的 worker 不会产生 finally 计时。

任务响应的 `phase` 仅在实际取得 `rawImages` 后为 `persisting`，状态仍为 `running`；该标记存在进程内临时 Map，finally 清理，终态优先覆盖。没有估算百分比、数据库字段或上游协议变化。前端类型必须允许 `persisting`，不要将它等同于图片已经安全保存。

## 排查

1. 用管理员会话获取快照，先比较 `since`，不要跨进程或重启直接相减。先看 count 是否足够，再看 p95 桶；小样本和大桶只能给出粗略范围。
2. 页面慢：比较同一路由的 route_ready、document_ready、ttfb。结合浏览器网络/渲染工具确认；这里只记录前端实际定义的就绪点，不代表所有图片已解码。
3. 图片慢：queue 高检查并发与积压；upstream 高检查供应商和渠道调度；persistence 高检查下载、磁盘和结果归档。先查看 succeeded 序列，再单独对比 failed/canceled，避免把失败的短耗时当作优化。
4. 出现持续用户可感知退化时，将 `since`、路由模板、计数和桶上界交给维护者；只在现有受限日志中按 requestId 关联，不导出提示词或凭据。此改动未配置告警阈值、外部监测或日志保留策略。

验证：`bun test server/lib/performance-metrics.test.ts`（包括严格字段/字节校验、基数、分位数、生命周期、限流和接口静态保护检查）。

import { Alert, App, Button, Checkbox, Drawer, Empty, Pagination, Segmented, Spin, Tag } from "antd";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/image-utils";
import { cleanupStorageFiles, fetchStorageOverview, type StorageOverview } from "@/services/storage-management";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { getStorageCleanupBlockReason } from "./storage-cleanup-guard";

const kindLabels: Record<string, string> = { image: "图片", video: "视频", audio: "音频", file: "其他" };
const statusLabels = { referenced: "正在使用", recent: "保护期内", unused: "可清理" };

export default function StorageManager() {
    const { modal, message } = App.useApp();
    const userId = useUserStore(state => state.user?.id || "");
    const cleanupBlockReason = useAssetStore(state => getStorageCleanupBlockReason(state, userId));
    const [open, setOpen] = useState(false);
    const [snapshot, setSnapshot] = useState<{ owner: string; data: StorageOverview } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<"all" | "unused">("all");
    const [refresh, setRefresh] = useState(0);
    const [selected, setSelected] = useState<string[]>([]);
    const [cleaning, setCleaning] = useState(false);
    const cleanupBusy = useRef(false);
    const data = snapshot?.owner === userId ? snapshot.data : null;

    useEffect(() => {
        setSelected([]);
        if (!open || !userId) return;
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void fetchStorageOverview(userId, page, filter, controller.signal).then(result => {
            if (!controller.signal.aborted) setSnapshot({ owner: userId, data: result });
        }).catch(reason => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "存储信息加载失败，请重试");
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [open, userId, page, filter, refresh]);

    const candidates = data?.items.filter(item => item.status === "unused") || [];
    const selectedFiles = candidates.filter(item => selected.includes(item.key));
    const selectedBytes = selectedFiles.reduce((sum, item) => sum + item.bytes, 0);
    const confirmCleanup = () => {
        if (!selectedFiles.length || cleaning || loading || error || cleanupBlockReason) return;
        const keys = selectedFiles.map(item => item.key);
        modal.confirm({
            title: `永久清理 ${keys.length} 个文件？`,
            content: `预计释放 ${formatBytes(selectedBytes)}。服务器会再次检查引用关系，仍被使用或处于保护期的文件不会删除。请先同步其他设备的草稿；文件删除后无法恢复。`,
            okText: "确认清理", cancelText: "保留文件", okButtonProps: { danger: true },
            onOk: async () => {
                if (cleanupBusy.current) return;
                const reason = getStorageCleanupBlockReason(useAssetStore.getState(), useUserStore.getState().user?.id || "", userId);
                if (reason) {
                    message.warning(reason);
                    throw new Error(reason);
                }
                cleanupBusy.current = true;
                setCleaning(true);
                try {
                    const result = await cleanupStorageFiles(userId, keys);
                    if (useUserStore.getState().user?.id !== userId) return;
                    const summary = `已清理 ${result.deletedCount} 个文件，释放 ${formatBytes(result.freedBytes)}`;
                    if (result.skippedCount) message.info(`${summary}；${result.skippedCount} 个文件状态已改变，已跳过`);
                    else message.success(summary);
                    setSelected([]);
                    setRefresh(value => value + 1);
                } catch (reason) {
                    if (useUserStore.getState().user?.id === userId) message.error(reason instanceof Error ? reason.message : "清理失败，请刷新后确认文件状态");
                    throw reason;
                } finally { cleanupBusy.current = false; setCleaning(false); }
            },
        });
    };

    return <>
        <Button icon={<HardDrive className="size-4" />} onClick={() => setOpen(true)}>存储管理</Button>
        <Drawer title="创作素材 · 存储管理" open={open} onClose={() => setOpen(false)} size="min(640px, 100vw)"
            extra={<Button type="text" aria-label="刷新存储信息" icon={<RefreshCw className="size-4" />} disabled={loading || cleaning} onClick={() => setRefresh(value => value + 1)} />}
            footer={<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted-foreground" aria-live="polite">已选 {selectedFiles.length} 个 · 预计释放 {formatBytes(selectedBytes)}</span>
                <Button danger icon={<Trash2 className="size-4" />} disabled={!selectedFiles.length || loading || Boolean(error) || Boolean(cleanupBlockReason)} loading={cleaning} onClick={confirmCleanup}>清理所选文件</Button>
            </div>}>
            <div className="space-y-6">
                <p className="text-sm leading-relaxed text-muted-foreground">删除藏卷阁收藏只移除收藏记录，不会立即删除被其他页面使用的原文件。这里仅清理已无云端引用的文件。</p>
                {cleanupBlockReason && <Alert type="warning" showIcon title={cleanupBlockReason} />}
                {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRefresh(value => value + 1)}>重试</Button>} />}
                {loading && <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status"><Spin size="small" />正在读取存储信息…</div>}
                {data && <>
                    <section className="space-y-4 rounded-xl border border-border p-4" aria-label="素材空间用量">
                        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-medium">素材空间</h3><span className="text-sm">{formatBytes(data.usedBytes)} / {formatBytes(data.limitBytes)}</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="素材空间已使用" aria-valuemin={0} aria-valuemax={data.limitBytes} aria-valuenow={Math.min(data.usedBytes, data.limitBytes)} aria-valuetext={`${formatBytes(data.usedBytes)}，共 ${formatBytes(data.limitBytes)}`}>
                            <div className="h-full bg-primary" style={{ width: `${Math.min(100, data.limitBytes > 0 ? data.usedBytes / data.limitBytes * 100 : 0)}%` }} />
                        </div>
                        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">可用空间</dt><dd className="mt-1 font-medium">{formatBytes(data.remainingBytes)}</dd></div><div><dt className="text-muted-foreground">可安全清理</dt><dd className="mt-1 font-medium">{formatBytes(data.reclaimableBytes)}</dd></div></dl>
                        <p className="text-xs leading-relaxed text-muted-foreground">{data.byKind.map(item => `${kindLabels[item.kind]} ${formatBytes(item.bytes)}`).join(" · ") || "暂无上传文件"}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">生成结果暂存：{formatBytes(data.generationOutputs.usedBytes)} / {formatBytes(data.generationOutputs.limitBytes)}，与素材空间分开计算；请到生成任务或历史记录中管理。</p>
                    </section>
                    <p className="text-sm leading-relaxed text-muted-foreground">最近 {Math.ceil(data.graceMs / 3_600_000)} 小时内上传的文件处于保护期。未同步的本地草稿无法被服务器识别，请完成同步后再清理。</p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Segmented value={filter} options={[{ label: "全部文件", value: "all" }, { label: "可清理", value: "unused" }]} onChange={value => { setFilter(value as "all" | "unused"); setPage(1); }} disabled={cleaning} />
                        <Checkbox disabled={!candidates.length || loading || cleaning || Boolean(error)} checked={Boolean(candidates.length && selectedFiles.length === candidates.length)} indeterminate={selectedFiles.length > 0 && selectedFiles.length < candidates.length} onChange={event => setSelected(event.target.checked ? candidates.map(item => item.key) : [])}>选择本页可清理文件</Checkbox>
                    </div>
                    {!data.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === "unused" ? "暂时没有可清理的文件" : "尚未使用素材空间"} /> : <ul className="divide-y divide-border">
                        {data.items.map(item => <li key={item.key} className="flex items-start gap-3 py-4">
                            <Checkbox className="pt-1" aria-label={`选择文件 ${item.key}`} checked={selected.includes(item.key)} disabled={item.status !== "unused" || loading || cleaning || Boolean(error)} onChange={event => setSelected(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />
                            <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{formatBytes(item.bytes)} <span className="font-normal text-muted-foreground">· {item.mimeType}</span></span><Tag>{statusLabels[item.status]}</Tag></div>
                                <p className="break-all text-xs text-muted-foreground">{item.key}</p>
                                <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                                <p className="text-sm leading-relaxed">{item.references.join("、") || (item.status === "recent" ? "新上传文件，暂不允许清理" : "未发现云端引用")}</p>
                            </div>
                        </li>)}
                    </ul>}
                    <Pagination size="small" current={data.page} pageSize={data.pageSize} total={data.total} showSizeChanger={false} onChange={setPage} disabled={loading || cleaning} hideOnSinglePage />
                </>}
            </div>
        </Drawer>
    </>;
}

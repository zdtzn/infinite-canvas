import { App, Button, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";

import { lazyRoute } from "@/lib/lazy-route";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { notifyPromptLibraryUpdated } from "@/lib/prompt-library-events";
import { deleteServerPromptSource, saveServerPromptSource } from "@/services/server-api";
import { isBuiltInPromptSource, PROMPT_SOURCE_INTERVAL_OPTIONS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUserStore } from "@/stores/use-user-store";

const PromptSourceEditorDrawer = lazyRoute(() => import("./prompt-source-editor-drawer").then((module) => ({ default: module.PromptSourceEditorDrawer })));
const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function ConfigPromptSources() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const user = useUserStore((state) => state.user);
    const canManageSources = !PUBLIC_MODE || Boolean(user?.admin);
    const statusQuery = useQuery({
        queryKey: STATUS_QUERY_KEY,
        queryFn: fetchPromptSourceStatuses,
        enabled: canManageSources,
        refetchInterval: (query) => Object.values(query.state.data ?? {}).some((status) => status.refreshing) ? 2_000 : false,
    });

    const [editingId, setEditingId] = useState("");
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [togglingId, setTogglingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);

    const editingSource = sources.find((item) => item.id === editingId) || null;
    const viewingSource = sources.find((item) => item.id === viewingId && (!PUBLIC_MODE || item.enabled)) || null;

    const handleAdd = () => {
        if (!canManageSources) return;
        const source = addSource();
        setEditingId(source.id);
    };

    const handleSave = async (source: PromptSource) => {
        try {
            const saved = PUBLIC_MODE ? (await saveServerPromptSource(source)).source : source;
            saveSource(saved);
            notifyPromptLibraryUpdated();
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.success("提示词来源已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词来源保存失败");
            throw error;
        }
    };

    const handleDelete = async (source: PromptSource) => {
        if (!canManageSources || (PUBLIC_MODE && isBuiltInPromptSource(source))) return;
        try {
            if (PUBLIC_MODE) await deleteServerPromptSource(source.id);
            removeSource(source.id);
            notifyPromptLibraryUpdated();
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.success("提示词来源已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词来源删除失败");
        }
    };

    const handleToggle = async (source: PromptSource, enabled: boolean) => {
        if (!canManageSources) return;
        if (!PUBLIC_MODE) {
            toggleSource(source.id, enabled);
            notifyPromptLibraryUpdated();
            return;
        }
        setTogglingId(source.id);
        try {
            const saved = (await saveServerPromptSource({ ...source, enabled })).source;
            saveSource(isBuiltInPromptSource(source) ? { ...saved, script: source.script } : saved);
            notifyPromptLibraryUpdated();
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        } catch (error) {
            message.error(userFacingErrorMessage(error, "提示词来源状态保存失败"));
        } finally {
            setTogglingId("");
        }
    };

    const handleRefreshOne = async (source: PromptSource) => {
        setRefreshingId(source.id);
        try {
            const count = await refreshSource(source.id);
            message.success(`「${source.name}」已更新，共 ${count} 条`);
        } catch (error) {
            message.error(userFacingErrorMessage(error, "暂时无法更新"));
        } finally {
            setRefreshingId("");
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        }
    };

    const handleRefreshAll = async () => {
        setRefreshingAll(true);
        try {
            const { count, succeeded, failed } = await refreshAllSources();
            if (succeeded) updateSchedule("lastFetchedAt", new Date().toISOString());
            if (!succeeded && !failed) message.info("没有启用的来源");
            else if (!succeeded) message.error(`${failed} 个来源更新失败，请查看各来源状态`);
            else if (failed) message.warning(`${succeeded} 个来源已更新，共 ${count} 条，${failed} 个来源更新失败`);
            else message.success(`全部来源已更新，共 ${count} 条`);
        } catch (error) {
            message.error(userFacingErrorMessage(error, "暂时无法更新提示词，请稍后再试"));
        } finally {
            setRefreshingAll(false);
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-stone-500">
                    {PUBLIC_MODE ? (user?.admin ? "管理员可新增、编辑和删除共享来源；脚本仅配置你信任的公开数据源。" : "这里显示管理员配置的提示词来源。") : "开启你喜欢的来源，也可以添加自己的提示词来源。"}
                </div>
                {canManageSources ? <Button type="primary" icon={<Plus className="size-4" />} onClick={handleAdd}>新增来源</Button> : null}
            </div>

            {canManageSources && statusQuery.isError && <div className="mb-3 text-xs text-red-600">暂时无法读取来源状态</div>}
            <div className="space-y-2">
                {sources.map((source) => {
                    const status = statusQuery.data?.[source.id];
                    return (
                        <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                <Switch size="small" checked={source.enabled} disabled={!canManageSources || Boolean(togglingId)} loading={togglingId === source.id} aria-label={`启用 ${source.name}`} onChange={(checked) => void handleToggle(source, checked)} />
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold">{source.name || "未命名来源"}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                        <span className="max-w-80 truncate">{source.githubUrl || "无来源地址"}</span>
                                        {!source.enabled && <Tag className="m-0 text-[10px]">已停用</Tag>}
                                        {canManageSources && (!PUBLIC_MODE || status) && (
                                            <>
                                                <span className="tabular-nums">{status?.count ?? 0} 条</span>
                                                {status?.refreshing ? <Tag color="processing" className="m-0 text-[10px]">更新中</Tag>
                                                    : status?.lastError ? <Tag color="error" className="m-0 text-[10px]" title={status.lastError}>更新失败</Tag>
                                                      : status?.lastSuccessAt ? <Tag color="success" className="m-0 text-[10px]">正常</Tag>
                                                        : <Tag className="m-0 text-[10px]">未同步</Tag>}
                                                <span>{status?.lastSuccessAt ? `上次更新 ${formatTime(status.lastSuccessAt)}` : "尚未更新"}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button size="small" icon={<Eye className="size-3.5" />} disabled={PUBLIC_MODE && !source.enabled} onClick={() => setViewingId(source.id)}>
                                    查看内容
                                </Button>
                                {canManageSources && (
                                    <Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={!source.enabled || refreshingAll || Boolean(refreshingId && refreshingId !== source.id)} loading={refreshingId === source.id || Boolean(status?.refreshing)} onClick={() => void handleRefreshOne(source)}>
                                        刷新
                                    </Button>
                                )}
                                {canManageSources && (!PUBLIC_MODE || !isBuiltInPromptSource(source)) ? <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingId(source.id)}>编辑脚本</Button> : null}
                                {canManageSources && (!PUBLIC_MODE || !isBuiltInPromptSource(source)) ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除来源" onClick={() => void handleDelete(source)} /> : null}
                            </div>
                        </div>
                    );
                })}
            </div>

            {canManageSources && (
                <section className="mt-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="mb-3 text-sm font-semibold">自动更新</div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500">更新间隔</span>
                            <Select size="small" className="w-36" value={schedule.intervalMinutes} options={PROMPT_SOURCE_INTERVAL_OPTIONS} onChange={(value) => updateSchedule("intervalMinutes", value)} />
                        </div>
                        <Button size="small" type="primary" icon={<RefreshCw className="size-3.5" />} loading={refreshingAll} disabled={Boolean(refreshingId) || !sources.some((source) => source.enabled)} onClick={() => void handleRefreshAll()}>
                            刷新全部
                        </Button>
                        <span className="text-xs text-stone-500">{schedule.lastFetchedAt ? `上次更新 ${formatTime(schedule.lastFetchedAt)}` : "尚未自动更新"}</span>
                    </div>
                    <div className="mt-2 text-xs text-stone-400">{PUBLIC_MODE ? "管理员打开网站时，会按所选间隔刷新已启用的来源。" : "网站打开时，会按所选间隔刷新已启用的来源。"}</div>
                </section>
            )}

            {canManageSources && editingSource && (!PUBLIC_MODE || !isBuiltInPromptSource(editingSource)) ? (
                <Suspense fallback={null}>
                    <PromptSourceEditorDrawer open source={editingSource} onSave={handleSave} onClose={() => setEditingId("")} />
                </Suspense>
            ) : null}
            <PromptSourceContentModal source={viewingSource} canRefresh={canManageSources && Boolean(viewingSource?.enabled)} onClose={() => setViewingId("")} />
        </div>
    );
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

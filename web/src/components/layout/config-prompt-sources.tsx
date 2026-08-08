import { App, Button, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";

import { lazyRoute } from "@/lib/lazy-route";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
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
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });
    const canManageSources = !PUBLIC_MODE || Boolean(user?.admin);

    const [editingId, setEditingId] = useState("");
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);

    const editingSource = sources.find((item) => item.id === editingId) || null;
    const viewingSource = sources.find((item) => item.id === viewingId) || null;

    const invalidatePromptQueries = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);

    const handleAdd = () => {
        if (!canManageSources) return;
        const source = addSource();
        setEditingId(source.id);
    };

    const handleSave = async (source: PromptSource) => {
        try {
            const saved = PUBLIC_MODE ? (await saveServerPromptSource(source)).source : source;
            saveSource(saved);
            await invalidatePromptQueries();
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
            await invalidatePromptQueries();
            message.success("提示词来源已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词来源删除失败");
        }
    };

    const handleToggle = async (source: PromptSource, enabled: boolean) => {
        if (PUBLIC_MODE && user?.admin && !isBuiltInPromptSource(source)) {
            try {
                saveSource((await saveServerPromptSource({ ...source, enabled })).source);
                await invalidatePromptQueries();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "提示词来源状态保存失败");
            }
            return;
        }
        toggleSource(source.id, enabled);
    };

    const handleRefreshOne = async (source: PromptSource) => {
        setRefreshingId(source.id);
        try {
            const count = await refreshSource(source.id);
            await invalidatePromptQueries();
            message.success(`「${source.name}」已拉取 ${count} 条`);
        } catch (error) {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.error(error instanceof Error ? `${error.message}，已保留旧缓存` : "更新失败，已保留旧缓存");
        } finally {
            setRefreshingId("");
        }
    };

    const handleRefreshAll = async () => {
        setRefreshingAll(true);
        try {
            const count = await refreshAllSources();
            updateSchedule("lastFetchedAt", new Date().toISOString());
            await invalidatePromptQueries();
            message.success(`全部来源已拉取，共 ${count} 条`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取失败");
        } finally {
            setRefreshingAll(false);
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-stone-500">
                    {PUBLIC_MODE ? (user?.admin ? "管理员可新增、编辑和删除共享来源；脚本仅配置你信任的公开数据源。" : "提示词来源由管理员统一配置，资源由本站代理缓存。") : "资源由浏览器按来源拉取和缓存，单个来源异常不会拖垮整个图库。"}
                </div>
                {canManageSources ? <Button type="primary" icon={<Plus className="size-4" />} onClick={handleAdd}>新增来源</Button> : null}
            </div>

            <div className="space-y-2">
                {sources.map((source) => {
                    const status = statusQuery.data?.[source.id];
                    return (
                        <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                <Switch size="small" checked={source.enabled} onChange={(checked) => void handleToggle(source, checked)} />
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold">{source.name || "未命名来源"}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                        <span className="max-w-80 truncate">{source.githubUrl || "无来源地址"}</span>
                                        <span className="tabular-nums">{status?.count ?? 0} 条</span>
                                        {status?.lastError ? <Tag color="error" className="m-0 text-[10px]" title={status.lastError}>失败</Tag> : status?.lastSuccessAt ? <Tag color="success" className="m-0 text-[10px]">正常</Tag> : <Tag className="m-0 text-[10px]">未同步</Tag>}
                                        <span>{status?.lastSuccessAt ? `上次成功 ${formatTime(status.lastSuccessAt)}` : "尚未拉取"}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setViewingId(source.id)}>
                                    查看内容
                                </Button>
                                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={refreshingId === source.id} onClick={() => void handleRefreshOne(source)}>
                                    立即拉取
                                </Button>
                                {canManageSources && (!PUBLIC_MODE || !isBuiltInPromptSource(source)) ? <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingId(source.id)}>编辑脚本</Button> : null}
                                {canManageSources && (!PUBLIC_MODE || !isBuiltInPromptSource(source)) ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除来源" onClick={() => void handleDelete(source)} /> : null}
                            </div>
                        </div>
                    );
                })}
            </div>

            <section className="mt-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="mb-3 text-sm font-semibold">定时拉取</div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">拉取周期</span>
                        <Select size="small" className="w-36" value={schedule.intervalMinutes} options={PROMPT_SOURCE_INTERVAL_OPTIONS} onChange={(value) => updateSchedule("intervalMinutes", value)} />
                    </div>
                    <Button size="small" type="primary" icon={<RefreshCw className="size-3.5" />} loading={refreshingAll} onClick={() => void handleRefreshAll()}>
                        全部立即拉取
                    </Button>
                    <span className="text-xs text-stone-500">{schedule.lastFetchedAt ? `上次拉取 ${formatTime(schedule.lastFetchedAt)}` : "尚未定时拉取"}</span>
                </div>
                <div className="mt-2 text-xs text-stone-400">开启周期后，页面打开期间会按周期自动拉取所有启用的来源。</div>
            </section>

            {canManageSources && editingSource && (!PUBLIC_MODE || !isBuiltInPromptSource(editingSource)) ? (
                <Suspense fallback={null}>
                    <PromptSourceEditorDrawer open source={editingSource} onSave={handleSave} onClose={() => setEditingId("")} />
                </Suspense>
            ) : null}
            <PromptSourceContentModal source={viewingSource} onClose={() => setViewingId("")} />
        </div>
    );
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

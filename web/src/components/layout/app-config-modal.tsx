import { App, Button, Form, Input, Modal, Progress, Select, Switch, Tabs, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Cloud, Pencil, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { PromptOptimizerAdminSetting } from "@/components/layout/prompt-optimizer-admin-setting";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { deleteServerChannel, reorderServerChannels, saveServerChannel, saveServerDefaultImageModel } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { ConfigMembers } from "@/components/layout/config-members";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ImperialModePreferences } from "@/features/cultivation/imperial-mode-preferences";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { useUserStore } from "@/stores/use-user-store";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { createModelChannel, decodeChannelModel, encodeChannelModel, modelOptionLabel, modelOptionsFromChannels, pickPlatformModel, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "audioModel";
    defaultLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    error?: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", defaultLabel: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", defaultLabel: "默认视频模型" },
    { capability: "audio", modelKey: "audioModel", defaultLabel: "默认音频模型" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的资产",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [reorderingChannels, setReorderingChannels] = useState(false);
    const [savingDefaultImageModel, setSavingDefaultImageModel] = useState(false);
    const defaultImageSave = useRef<object | null>(null);
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavSyncError, setWebdavSyncError] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const platformImageDefault = useConfigStore((state) => state.platformImageDefault);
    const platformImageDefaultLoaded = useConfigStore((state) => state.platformImageDefaultLoaded);
    const setPlatformImageDefault = useConfigStore((state) => state.setPlatformImageDefault);
    const user = useUserStore((state) => state.user);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const canManageChannels = !PUBLIC_MODE || Boolean(user?.admin);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = canManageChannels ? config.channels.find((channel) => channel.id === editingChannelId) || null : null;
    const platformImageModel = platformImageDefault ? encodeChannelModel(platformImageDefault.channelId, platformImageDefault.model) : "";
    useEffect(() => setActiveTab(initialTab === "channels" && !canManageChannels ? "preferences" : initialTab), [canManageChannels, initialTab]);
    useEffect(() => {
        if (!canManageChannels) setEditingChannelId("");
    }, [canManageChannels]);
    useEffect(() => {
        defaultImageSave.current = null;
        setSavingDefaultImageModel(false);
        return () => { defaultImageSave.current = null; };
    }, [user?.id, user?.admin]);

    const saveDefaultImageModel = async (value: string) => {
        if (!user?.id || !user.admin || !platformImageDefaultLoaded || defaultImageSave.current) return;
        const target = decodeChannelModel(value);
        if (!target) return;
        const ownerId = user.id;
        const request = {};
        defaultImageSave.current = request;
        setSavingDefaultImageModel(true);
        const isCurrentRequest = () => defaultImageSave.current === request && useUserStore.getState().user?.id === ownerId && Boolean(useUserStore.getState().user?.admin);
        try {
            const saved = await saveServerDefaultImageModel(target, ownerId);
            if (!isCurrentRequest()) return;
            setPlatformImageDefault(saved.image);
            message.success("全站默认生图模型已更新");
        } catch (error) {
            if (isCurrentRequest()) message.error(userFacingErrorMessage(error, "默认生图模型暂时未能保存，请稍后再试"));
        } finally {
            if (defaultImageSave.current === request) {
                defaultImageSave.current = null;
                setSavingDefaultImageModel(false);
            }
        }
    };

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && (channel.credentialState === "saved" || channel.apiKey.trim()) && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        if (!canManageChannels) return;
        const channel = createModelChannel({ name: `渠道 ${config.channels.length + 1}`, sortOrder: nextChannelSortOrder(config.channels) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const moveChannel = async (index: number, offset: -1 | 1) => {
        if (!canManageChannels || reorderingChannels) return;
        const nextIndex = index + offset;
        if (nextIndex < 0 || nextIndex >= config.channels.length) return;

        const previousChannels = config.channels;
        const nextChannels = [...config.channels];
        [nextChannels[index], nextChannels[nextIndex]] = [nextChannels[nextIndex], nextChannels[index]];
        const orderedChannels = nextChannels.map((channel, sortOrder) => ({ ...channel, sortOrder }));
        updateChannels(orderedChannels);

        if (!PUBLIC_MODE) return;
        setReorderingChannels(true);
        try {
            await reorderServerChannels(orderedChannels.map((channel) => channel.id));
            message.success("渠道顺序已保存");
        } catch (error) {
            updateChannels(previousChannels);
            message.error(error instanceof Error ? error.message : "渠道排序保存失败");
        } finally {
            setReorderingChannels(false);
        }
    };

    const deleteChannel = (id: string) => {
        if (!canManageChannels) return;
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
        if (PUBLIC_MODE) void deleteServerChannel(id).catch(() => undefined);
    };

    const saveChannel = async (channel: ModelChannel) => {
        if (!canManageChannels) return;
        if (PUBLIC_MODE) await saveServerChannel(channel);
        const saved = PUBLIC_MODE ? { ...channel, apiKey: "", credentialState: "saved" as const } : channel;
        updateChannels(config.channels.map((item) => (item.id === channel.id ? saved : item)));
        message.success("渠道已保存");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(userFacingErrorMessage(error, "暂时无法连接 WebDAV，请检查地址和账号后再试"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        const stage = event.status === "exception" ? webdavSyncErrorMessage(event.stage, "这部分内容未能同步，请检查连接后重试") : event.stage;
        setWebdavSyncStatus(stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage,
                error: event.status === "exception" ? event.stage : undefined,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavSyncError("");
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个资产，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const feedback = webdavSyncErrorMessage(detail, "同步未完成，请检查连接后重试");
            setWebdavSyncStatus(feedback);
            setWebdavSyncError(detail);
            message.error(feedback);
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <div>
                                {PUBLIC_MODE && user?.admin ? <PromptOptimizerAdminSetting config={config} /> : null}
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">每个渠道选择一个协议并拉取模型，为每个模型指定能力（生图/视频/文本/音频）。公网模式下 API Key 仅加密保存在服务端。</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel, index) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · {channel.models.length} 个模型 · {channel.baseUrl || "未填写接口地址"}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <Tooltip title="上移">
                                                    <Button type="text" size="small" icon={<ArrowUp className="size-3.5" />} disabled={reorderingChannels || index === 0} onClick={() => void moveChannel(index, -1)} aria-label="上移渠道" />
                                                </Tooltip>
                                                <Tooltip title="下移">
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<ArrowDown className="size-3.5" />}
                                                        disabled={reorderingChannels || index === config.channels.length - 1}
                                                        onClick={() => void moveChannel(index, 1)}
                                                        aria-label="下移渠道"
                                                    />
                                                </Tooltip>
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    编辑
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    ...(PUBLIC_MODE && user?.admin ? [{ key: "members", label: "成员", children: <ConfigMembers /> }] : []),
                    {
                        key: "preferences",
                        label: "偏好设置",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 text-sm font-semibold">默认模型</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} extra={PUBLIC_MODE && group.capability === "image" ? (user?.admin ? "修改后对所有用户生效，仍可在丹青台自行切换。" : "由管理员统一设置，仍可在丹青台自行切换。") : undefined} className="mb-0">
                                            {PUBLIC_MODE && group.capability === "image" ? (
                                                user?.admin ? (
                                                    <ModelPicker config={config} value={platformImageModel} onChange={(model) => void saveDefaultImageModel(model)} capability="image" fullWidth disabled={!platformImageDefaultLoaded || savingDefaultImageModel} placeholder={platformImageDefaultLoaded ? "选择全站默认生图模型" : "正在读取默认模型…"} />
                                                ) : (
                                                    <div className="flex min-h-8 items-center text-sm">{!platformImageDefaultLoaded ? "正在读取默认模型…" : platformImageModel ? modelOptionLabel(config, platformImageModel) : "暂未设置"}</div>
                                                )
                                            ) : (
                                                <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                            )}
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">生成偏好</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认图片分辨率" extra="新建生图和配置节点使用，具体模型会按支持的分辨率调整。" className="mb-4">
                                        <Select
                                            value={config.quality}
                                            options={[
                                                { value: "low", label: "1K" },
                                                { value: "medium", label: "2K" },
                                                { value: "high", label: "4K" },
                                            ]}
                                            onChange={(value) => updateConfig("quality", value)}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认视频分辨率" extra="新建视频和配置节点使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Select
                                            value={config.vquality.replace(/p$/i, "")}
                                            options={[
                                                { value: "480", label: "480p" },
                                                { value: "720", label: "720p" },
                                                { value: "1080", label: "1080p" },
                                            ]}
                                            onChange={(value) => updateConfig("vquality", value)}
                                        />
                                    </Form.Item>
                                    <Form.Item label="选中节点时自动居中" className="mb-4">
                                        <Switch checked={config.autoFocusOnSelect} onChange={(value) => updateConfig("autoFocusOnSelect", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                                <ImperialModePreferences />
                                <ConfigLocalProxy />
                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: "提示词来源",
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">按账户同步画布、我的资产、生成记录和本地媒体文件，不包含 AI API Key；可在偏好设置中启用本地代理。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra="当前账户的备份会在这个目录下单独保存。" className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <details className="mt-2 text-xs text-stone-500">
                                        <summary className="min-h-11 cursor-pointer py-3">高级说明</summary>
                                        <p className="break-words">{`内容保存在远程目录的 users/账户/业务 下，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/；原有未分账户的备份保留不动。`}</p>
                                    </details>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {webdavSyncError ? (
                                        <div className="mt-2 text-xs text-stone-500">
                                            <p role="alert">部分内容可能已同步，请核对各项结果后重试。</p>
                                            <details>
                                                <summary className="min-h-11 cursor-pointer py-3">查看技术详情</summary>
                                                <p className="whitespace-pre-wrap break-words">{webdavSyncError}</p>
                                            </details>
                                        </div>
                                    ) : null}
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "local-storage",
                        label: "本地存储",
                        children: <ConfigLocalStorage active={activeTab === "local-storage"} />,
                    },
                ].filter((item) => canManageChannels || item.key !== "channels")}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig} disabled={savingDefaultImageModel}>
                        完成
                    </Button>
                </div>
            ) : null}
            {canManageChannels ? <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} /> : null}
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、默认模型和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: PUBLIC_MODE ? "" : channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickPlatformModel(next, "image", config.imageModel),
        videoModel: pickPlatformModel(next, "video", config.videoModel),
        textModel: pickPlatformModel(next, "text", config.textModel),
        audioModel: pickPlatformModel(next, "audio", config.audioModel),
    };
}

function nextChannelSortOrder(channels: ModelChannel[]) {
    return (
        channels.reduce((highest, channel, index) => {
            const sortOrder = Number(channel.sortOrder);
            return Math.max(highest, Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : index);
        }, -1) + 1
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? "Gemini" : "OpenAI";
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className={`min-w-0 text-right text-stone-500 ${item.status === "exception" ? "break-words" : "truncate"}`}>
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                        {item.error ? (
                            <details className="text-xs text-stone-500">
                                <summary className="min-h-11 cursor-pointer py-3">查看技术详情</summary>
                                <p className="whitespace-pre-wrap break-words">{item.error}</p>
                            </details>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

function webdavSyncErrorMessage(detail: string, fallback: string) {
    if (/ETag|无法安全合并/i.test(detail)) return "为保护已有备份，已暂停同步，请检查远端服务设置后重试";
    if (detail.includes("清单已被其他设备更新")) return "远端备份已被其他设备更新，请重新同步";
    if (detail.includes("账户已切换")) return "账户已切换，请重新开始同步";
    if (detail.includes("同步清单不是当前应用的数据")) return "远端备份与当前内容不匹配，请检查远程目录后重试";
    if (detail.includes("认证失败")) return "同步身份验证失败，请检查用户名和密码后重试";
    if (detail.includes("路径不存在")) return "同步目录无法访问，请检查地址和远程目录后重试";
    return fallback;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

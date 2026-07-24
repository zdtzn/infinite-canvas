import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Result, Select, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Edit3, Eye, Info, RefreshCw, Sparkles } from "lucide-react";
import { createRef, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { previewCultivationBreakthrough } from "@/features/cultivation/breakthrough-overlay";
import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationAccentColor, cultivationStageLabel } from "@/features/cultivation/utils";
import {
    approveAdminBreakthrough,
    fetchAdminCultivationUsers,
    fetchCultivationConfiguration,
    fetchCultivationLog,
    updateAdminCultivationUser,
    updateCultivationCapability,
    updateCultivationRealm,
    updateCultivationRewards,
    updateCultivationStage,
    type CultivationConfiguration,
    type CultivationProfile,
    type CultivationRealmConfig,
    type CultivationStageConfig,
} from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

type AdminCultivationUser = CultivationProfile & { status: string };
type AdminTabKey = "users" | "config" | "usage" | "logs";
type UserFormValues = {
    stageId: string;
    currentXp?: number;
    xpDelta?: number;
    dailyLimitOverride?: number | null;
    unlimited?: boolean;
    status?: string;
    internalNote?: string;
    publicMessage?: string;
    reason: string;
};
type RealmFormValues = {
    name: string;
    color: string;
    iconKey: string;
    dailyLimit?: number | null;
    maxConcurrency?: number;
    promotionPolicy?: CultivationRealmConfig["promotionPolicy"];
    animationPreset?: string;
    active?: boolean;
    reason: string;
};
type StageFormValues = {
    name: string;
    requiredXp?: number;
    capabilities?: string[];
    active?: boolean;
    reason: string;
};
type LogKind = "ledger" | "usage" | "audit-logs" | "login-logs" | "breakthroughs";
type LogRow = Record<string, unknown>;

const iconOptions = [
    ["Aperture", "光圈"],
    ["Sparkles", "星芒"],
    ["CircleDot", "圆点"],
    ["Diamond", "菱形"],
    ["Gauge", "刻度"],
    ["Hexagon", "六边形"],
    ["Infinity", "无限"],
    ["Orbit", "轨道"],
    ["Shield", "护盾"],
    ["Crown", "冠冕"],
    ["Star", "星形"],
    ["Sun", "日曜"],
    ["Waves", "波纹"],
] as const;

const promotionPolicyOptions = [
    { value: "auto", label: "自动升级" },
    { value: "manual", label: "全部需审批" },
    { value: "boundary_manual", label: "同境界自动，跨境界审批" },
] satisfies Array<{ value: CultivationRealmConfig["promotionPolicy"]; label: string }>;

const animationOptions = [
    { value: "minimal-line", label: "简洁位移" },
    { value: "soft-flare", label: "柔和强调" },
    { value: "digital-ring", label: "数字环" },
];

const accountStatusOptions = [
    { value: "NORMAL", label: "正常" },
    { value: "DISABLED", label: "已停用" },
    { value: "BANNED", label: "已封禁" },
];

export default function AdminCultivationPage() {
    const admin = useUserStore((state) => Boolean(state.user?.admin));
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedTab = searchParams.get("tab");
    const activeTab: AdminTabKey = requestedTab === "config" || requestedTab === "usage" || requestedTab === "logs" ? requestedTab : "users";
    const { data: configuration, isLoading: configurationLoading } = useQuery({
        queryKey: ["admin", "cultivation", "config"],
        queryFn: fetchCultivationConfiguration,
        enabled: admin,
    });

    const updateParams = (updates: Record<string, string | null>) => {
        const next = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setSearchParams(next, { replace: true });
    };

    const previewBreakthrough = () => {
        const realm = configuration?.realms.find((item) => item.active && item.stages.filter((stage) => stage.active).length > 1);
        const stages = realm?.stages.filter((stage) => stage.active) || [];
        if (!realm || stages.length < 2) return;
        previewCultivationBreakthrough({
            fromStageName: cultivationStageLabel(realm.name, stages[0].name),
            toStageName: cultivationStageLabel(realm.name, stages[1].name),
            animationPreset: realm.animationPreset,
        });
    };

    const openUserFromLog = (displayName: string) => updateParams({ tab: "users", search: displayName });

    if (!admin) return <Result status="403" title="无权访问" subTitle="只有管理员可以进入修炼管理。" />;

    return (
        <main className="cultivation-admin-page h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
                <header className="cultivation-admin-header">
                    <div>
                        <p className="cultivation-eyebrow">后台管理</p>
                        <h1 className="mt-1 text-2xl font-semibold text-stone-950 dark:text-stone-50">修炼管理</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">管理用户的成长状态、创作额度和可用能力。所有变更都会进入审计日志。</p>
                    </div>
                    <Tooltip title="查看非阻塞式突破反馈">
                        <Button icon={<Sparkles className="size-4" />} disabled={configurationLoading || !configuration?.realms.some((realm) => realm.active && realm.stages.filter((stage) => stage.active).length > 1)} onClick={previewBreakthrough}>
                            预览突破反馈
                        </Button>
                    </Tooltip>
                </header>

                <Tabs
                    className="cultivation-admin-tabs"
                    activeKey={activeTab}
                    onChange={(key) => updateParams({ tab: key, search: key === "users" ? searchParams.get("search") : null })}
                    items={[
                        {
                            key: "users",
                            label: "用户",
                            children: <UsersPanel searchFromUrl={searchParams.get("search") || ""} onSearchChange={(search) => updateParams({ search })} />,
                        },
                        { key: "config", label: "配置", children: <ConfigurationPanel /> },
                        { key: "usage", label: "用量", children: <LogPanel kind="usage" title="生成用量" description="按任务记录请求、成功结算和耗时。" onOpenUser={openUserFromLog} /> },
                        { key: "logs", label: "日志", children: <LogsPanel onOpenUser={openUserFromLog} /> },
                    ]}
                />
            </div>
        </main>
    );
}

function UsersPanel({ searchFromUrl, onSearchChange }: { searchFromUrl: string; onSearchChange: (search: string) => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [searchDraft, setSearchDraft] = useState(searchFromUrl);
    const [editing, setEditing] = useState<AdminCultivationUser | null>(null);
    const { data, isFetching } = useQuery({
        queryKey: ["admin", "cultivation", "users", page, searchFromUrl],
        queryFn: () => fetchAdminCultivationUsers(page, 20, searchFromUrl),
    });
    const { data: config } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });

    useEffect(() => {
        setSearchDraft(searchFromUrl);
        setPage(1);
    }, [searchFromUrl]);

    const mutation = useMutation({
        mutationFn: ({ userId, values }: { userId: string; values: UserFormValues }) => updateAdminCultivationUser(userId, values),
        onSuccess: () => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation"] });
            void queryClient.invalidateQueries({ queryKey: ["cultivation", "profile"] });
            message.success("用户修炼信息已更新");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const approve = useMutation({
        mutationFn: ({ userId, reason }: { userId: string; reason: string }) => approveAdminBreakthrough(userId, reason),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation"] });
            message.success("突破已批准");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "审批失败"),
    });

    const stageOptions = useMemo(
        () =>
            config?.realms.map((realm) => ({
                label: realm.name,
                options: realm.stages.map((stage) => ({ value: stage.id, label: cultivationStageLabel(realm.name, stage.name) })),
            })) || [],
        [config],
    );
    const stageNameById = useMemo(() => new Map(config?.realms.flatMap((realm) => realm.stages.map((stage) => [stage.id, cultivationStageLabel(realm.name, stage.name)])) || []), [config]);

    const columns: ColumnsType<AdminCultivationUser> = [
        {
            title: "用户",
            key: "user",
            width: 210,
            render: (_: unknown, user) => <UserIdentity user={user} />,
        },
        {
            title: "当前境界",
            key: "realm",
            width: 190,
            render: (_: unknown, user) => <RealmBadge user={user} />,
        },
        {
            title: "修为",
            key: "xp",
            width: 132,
            align: "right",
            render: (_: unknown, user) => (
                <span className="cultivation-count">
                    {user.currentXp.toLocaleString()} / {user.requiredXp.toLocaleString()}
                </span>
            ),
        },
        {
            title: "今日额度",
            key: "quota",
            width: 124,
            align: "right",
            render: (_: unknown, user) => <span className="cultivation-count">{user.unlimited ? "不限" : `${user.usedToday}/${user.dailyLimit ?? 0}`}</span>,
        },
        {
            title: "状态",
            key: "status",
            width: 100,
            render: (_: unknown, user) => <AccountStatusTag status={user.status} />,
        },
        {
            title: "突破审批",
            key: "approval",
            width: 200,
            render: (_: unknown, user) =>
                user.pendingStageId ? (
                    <div className="flex min-w-0 items-center gap-2">
                        <Tag color="gold">待审批</Tag>
                        <span className="truncate text-sm text-stone-500 dark:text-stone-400" title={stageNameById.get(user.pendingStageId)}>
                            {stageNameById.get(user.pendingStageId) || "下一阶段"}
                        </span>
                        <Tooltip title="批准突破">
                            <Button
                                size="small"
                                type="text"
                                icon={<Check className="size-4" />}
                                loading={approve.isPending && approve.variables?.userId === user.userId}
                                onClick={() => promptReason("批准突破", (reason) => approve.mutate({ userId: user.userId, reason }))}
                                aria-label="批准突破"
                            />
                        </Tooltip>
                    </div>
                ) : (
                    <span className="text-sm text-stone-400">无需审批</span>
                ),
        },
        {
            title: "",
            key: "actions",
            width: 56,
            fixed: "right",
            render: (_: unknown, user) => (
                <Tooltip title="编辑用户">
                    <Button type="text" shape="circle" icon={<Edit3 className="size-4" />} onClick={() => setEditing(user)} aria-label={`编辑 ${user.displayName}`} />
                </Tooltip>
            ),
        },
    ];

    return (
        <section className="cultivation-admin-panel">
            <div className="cultivation-admin-panel-header">
                <div>
                    <h2>用户成长状态</h2>
                    <p>查看用户当前境界、额度与待审批突破，修改操作需填写原因。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Input.Search
                        allowClear
                        value={searchDraft}
                        placeholder="搜索昵称"
                        className="w-64 max-w-full"
                        onChange={(event) => {
                            const value = event.target.value;
                            setSearchDraft(value);
                            if (!value) onSearchChange("");
                        }}
                        onSearch={(value) => onSearchChange(value.trim())}
                    />
                    <Tooltip title="刷新用户列表">
                        <Button type="text" shape="circle" icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "users"] })} aria-label="刷新用户列表" />
                    </Tooltip>
                </div>
            </div>

            <Table<AdminCultivationUser>
                className="cultivation-admin-table"
                rowKey="userId"
                size="middle"
                loading={isFetching}
                dataSource={data?.items || []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配用户" /> }}
                scroll={{ x: 1050 }}
                pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false, showTotal: (total) => `共 ${total} 位用户` }}
                columns={columns}
            />

            <UserDrawer user={editing} stageOptions={stageOptions} loading={mutation.isPending} onClose={() => setEditing(null)} onSubmit={(values) => editing && mutation.mutate({ userId: editing.userId, values })} />
        </section>
    );
}

function UserDrawer({
    user,
    stageOptions,
    loading,
    onClose,
    onSubmit,
}: {
    user: AdminCultivationUser | null;
    stageOptions: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
    loading: boolean;
    onClose: () => void;
    onSubmit: (values: UserFormValues) => void;
}) {
    const [form] = Form.useForm<UserFormValues>();
    const [dirty, setDirty] = useState(false);
    const requestClose = () => {
        if (!dirty || loading) return onClose();
        confirmDiscard(onClose);
    };
    const save = async () => {
        const values = await form.validateFields();
        if (values.status && values.status !== "NORMAL" && values.status !== user?.status) {
            Modal.confirm({
                title: values.status === "BANNED" ? "确认封禁该账号？" : "确认停用该账号？",
                icon: null,
                content: "账号将无法继续登录和创建任务。该操作会记录到管理员日志。",
                okText: "确认更改",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => onSubmit(values),
            });
            return;
        }
        onSubmit(values);
    };

    return (
        <Drawer
            title="调整用户"
            open={Boolean(user)}
            width={520}
            rootClassName="cultivation-admin-drawer"
            onClose={requestClose}
            destroyOnHidden
            afterOpenChange={(open) => {
                if (!open || !user) return;
                form.setFieldsValue({
                    stageId: user.stageId,
                    currentXp: user.currentXp,
                    xpDelta: 0,
                    dailyLimitOverride: user.dailyLimitOverride,
                    unlimited: user.unlimited,
                    status: user.status,
                    internalNote: user.internalNote,
                    publicMessage: user.publicMessage,
                    reason: "",
                });
                setDirty(false);
            }}
            footer={
                <div className="cultivation-drawer-footer">
                    <span>{dirty ? "有未保存的更改" : "修改会写入审计日志"}</span>
                    <div className="flex gap-2">
                        <Button onClick={requestClose} disabled={loading}>
                            取消
                        </Button>
                        <Button type="primary" loading={loading} onClick={() => void save()}>
                            保存更改
                        </Button>
                    </div>
                </div>
            }
        >
            {user ? (
                <div className="cultivation-drawer-identity">
                    <UserIdentity user={user} large />
                    <AccountStatusTag status={user.status} />
                </div>
            ) : null}
            <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                <Tabs
                    className="cultivation-drawer-tabs"
                    items={[
                        {
                            key: "growth",
                            label: "成长",
                            children: (
                                <div className="pt-2">
                                    <Form.Item label="境界与阶段" name="stageId">
                                        <Select showSearch optionFilterProp="label" options={stageOptions} />
                                    </Form.Item>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Form.Item label="当前阶段修为" name="currentXp" extra="直接设置当前阶段进度">
                                            <InputNumber min={0} className="w-full" />
                                        </Form.Item>
                                        <Form.Item label="修为增减" name="xpDelta" extra="正数奖励，负数扣除">
                                            <InputNumber className="w-full" />
                                        </Form.Item>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "quota",
                            label: "额度与状态",
                            children: (
                                <div className="pt-2">
                                    <div className="grid grid-cols-2 gap-3">
                                        <Form.Item label="每日次数覆盖" name="dailyLimitOverride" extra="留空则继承境界规则">
                                            <InputNumber min={0} className="w-full" />
                                        </Form.Item>
                                        <Form.Item label="不限次数" name="unlimited" valuePropName="checked" extra="优先于每日次数覆盖">
                                            <Switch />
                                        </Form.Item>
                                    </div>
                                    <Form.Item label="账号状态" name="status" extra="停用或封禁后，用户不能继续创建任务。">
                                        <Select options={accountStatusOptions} />
                                    </Form.Item>
                                </div>
                            ),
                        },
                        {
                            key: "notes",
                            label: "备注",
                            children: (
                                <div className="pt-2">
                                    <Form.Item label="内部备注" name="internalNote" extra="仅管理员可见。">
                                        <Input.TextArea rows={4} maxLength={500} showCount />
                                    </Form.Item>
                                    <Form.Item label="公开留言" name="publicMessage" extra="显示在用户的“我的修炼”页面。">
                                        <Input.TextArea rows={4} maxLength={500} showCount />
                                    </Form.Item>
                                </div>
                            ),
                        },
                    ]}
                />
                <Form.Item className="mt-5" label="调整原因" name="reason" rules={[{ required: true, min: 2, message: "请填写调整原因" }]}>
                    <Input.TextArea rows={2} maxLength={300} showCount placeholder="说明本次调整的原因" />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function ConfigurationPanel() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });
    const [realm, setRealm] = useState<CultivationRealmConfig | null>(null);
    const [stage, setStage] = useState<CultivationStageConfig | null>(null);

    if (!data) return isLoading ? <div className="py-16 text-center text-sm text-stone-500">正在加载配置...</div> : <Empty description="配置暂不可用" />;

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "config"] });
    const saveRealm = async (values: RealmFormValues) => {
        if (!realm) return;
        try {
            await updateCultivationRealm(realm.id, values);
            setRealm(null);
            await refresh();
            message.success("境界配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const saveStage = async (values: StageFormValues) => {
        if (!stage) return;
        try {
            await updateCultivationStage(stage.id, values);
            setStage(null);
            await refresh();
            message.success("阶段配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    return (
        <section className="cultivation-admin-panel">
            <div className="cultivation-admin-panel-header">
                <div>
                    <h2>成长规则配置</h2>
                    <p>按境界、阶段和能力分别配置，避免在一个长表单中混合修改。</p>
                </div>
            </div>
            <Tabs
                className="cultivation-admin-tabs cultivation-admin-subtabs"
                items={[
                    { key: "realms", label: "境界", children: <RealmsConfiguration realms={data.realms} onEdit={setRealm} /> },
                    { key: "stages", label: "阶段", children: <StagesConfiguration realms={data.realms} onEdit={setStage} /> },
                    {
                        key: "rules",
                        label: "奖励与能力",
                        children: (
                            <div className="space-y-10 pt-2">
                                <RewardEditor configuration={data} onSaved={refresh} />
                                <CapabilityEditor configuration={data} onSaved={refresh} />
                            </div>
                        ),
                    },
                ]}
            />
            <RealmDrawer realm={realm} onClose={() => setRealm(null)} onSubmit={saveRealm} />
            <StageDrawer stage={stage} capabilities={data.capabilities} onClose={() => setStage(null)} onSubmit={saveStage} />
        </section>
    );
}

function RealmsConfiguration({ realms, onEdit }: { realms: CultivationRealmConfig[]; onEdit: (realm: CultivationRealmConfig) => void }) {
    const columns: ColumnsType<CultivationRealmConfig> = [
        {
            title: "境界",
            key: "realm",
            width: 220,
            render: (_: unknown, realm) => <RealmConfigIdentity realm={realm} />,
        },
        { title: "每日额度", key: "dailyLimit", width: 118, align: "right", render: (_: unknown, realm) => <span className="cultivation-count">{realm.dailyLimit === null ? "不限" : `${realm.dailyLimit} 次`}</span> },
        { title: "最大并发", dataIndex: "maxConcurrency", width: 105, align: "right", render: (value: number) => <span className="cultivation-count">{value}</span> },
        { title: "升级策略", dataIndex: "promotionPolicy", width: 190, render: (value: CultivationRealmConfig["promotionPolicy"]) => promotionPolicyLabel(value) },
        { title: "阶段", key: "stages", width: 94, align: "right", render: (_: unknown, realm) => <span className="cultivation-count">{realm.stages.length}</span> },
        { title: "状态", dataIndex: "active", width: 94, render: (active: boolean) => (active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
        {
            title: "",
            key: "actions",
            width: 56,
            fixed: "right",
            render: (_: unknown, realm) => (
                <Tooltip title="编辑境界">
                    <Button type="text" shape="circle" icon={<Edit3 className="size-4" />} onClick={() => onEdit(realm)} aria-label={`编辑 ${realm.name}`} />
                </Tooltip>
            ),
        },
    ];
    return <Table<CultivationRealmConfig> className="cultivation-admin-table mt-2" rowKey="id" size="middle" pagination={false} scroll={{ x: 900 }} dataSource={realms} columns={columns} />;
}

function StagesConfiguration({ realms, onEdit }: { realms: CultivationRealmConfig[]; onEdit: (stage: CultivationStageConfig) => void }) {
    const [selectedRealmId, setSelectedRealmId] = useState("");
    useEffect(() => {
        if (!realms.some((realm) => realm.id === selectedRealmId)) setSelectedRealmId(realms[0]?.id || "");
    }, [realms, selectedRealmId]);
    const selectedRealm = realms.find((realm) => realm.id === selectedRealmId) || realms[0];
    const columns: ColumnsType<CultivationStageConfig> = [
        {
            title: "阶段",
            dataIndex: "name",
            width: 200,
            render: (name: string, stage) => (
                <div>
                    <div className="font-medium text-stone-900 dark:text-stone-100">{name}</div>
                    <div className="mt-1 text-xs text-stone-500">阶段序号 {stage.order}</div>
                </div>
            ),
        },
        { title: "升级所需修为", dataIndex: "requiredXp", width: 150, align: "right", render: (value: number) => <span className="cultivation-count">{value.toLocaleString()}</span> },
        { title: "已开放能力", key: "capabilities", width: 130, align: "right", render: (_: unknown, stage) => <span className="cultivation-count">{stage.capabilities.length} 项</span> },
        { title: "状态", dataIndex: "active", width: 94, render: (active: boolean) => (active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
        {
            title: "",
            key: "actions",
            width: 56,
            fixed: "right",
            render: (_: unknown, stage) => (
                <Tooltip title="编辑阶段">
                    <Button type="text" shape="circle" icon={<Edit3 className="size-4" />} onClick={() => onEdit(stage)} aria-label={`编辑 ${stage.name}`} />
                </Tooltip>
            ),
        },
    ];

    return (
        <div className="pt-2">
            <div className="cultivation-admin-scope">
                <div>
                    <h3>阶段规则</h3>
                    <p>阶段只在当前选中的境界范围内展示，避免跨境界表格造成误改。</p>
                </div>
                <Select value={selectedRealm?.id} options={realms.map((realm) => ({ value: realm.id, label: realm.name }))} onChange={setSelectedRealmId} className="w-52 max-w-full" aria-label="选择境界" />
            </div>
            <Table<CultivationStageConfig>
                className="cultivation-admin-table"
                rowKey="id"
                size="middle"
                pagination={false}
                scroll={{ x: 720 }}
                dataSource={selectedRealm?.stages || []}
                columns={columns}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该境界暂无阶段" /> }}
            />
        </div>
    );
}

function RealmDrawer({ realm, onClose, onSubmit }: { realm: CultivationRealmConfig | null; onClose: () => void; onSubmit: (values: RealmFormValues) => void }) {
    const [form] = Form.useForm<RealmFormValues>();
    const [dirty, setDirty] = useState(false);
    const requestClose = () => {
        if (!dirty) return onClose();
        confirmDiscard(onClose);
    };
    const preview = () => {
        const values = form.getFieldsValue();
        const realmName = values.name || realm?.name || "当前境界";
        previewCultivationBreakthrough({ fromStageName: `${realmName} · 当前阶段`, toStageName: `${realmName} · 下一阶段`, animationPreset: values.animationPreset || realm?.animationPreset });
    };
    return (
        <Drawer
            title="编辑境界规则"
            open={Boolean(realm)}
            width={500}
            rootClassName="cultivation-admin-drawer"
            onClose={requestClose}
            destroyOnHidden
            afterOpenChange={(open) => {
                if (!open || !realm) return;
                form.setFieldsValue({ ...realm, reason: "" });
                setDirty(false);
            }}
            footer={<DrawerFooter dirty={dirty} onCancel={requestClose} onSave={() => form.validateFields().then(onSubmit)} />}
        >
            <p className="cultivation-drawer-intro">境界配置会影响新创建的生图任务和后续成长，不会改写历史记录。</p>
            <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                <Form.Item label="境界名称" name="name" rules={[{ required: true, message: "请输入境界名称" }]}>
                    <Input maxLength={32} />
                </Form.Item>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                    <Form.Item label="境界颜色" name="color">
                        <Input type="color" className="h-10 p-1" />
                    </Form.Item>
                    <Form.Item label="启用" name="active" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </div>
                <Form.Item label="境界标记" name="iconKey">
                    <Select
                        options={iconOptions.map(([value, label]) => ({
                            value,
                            label: (
                                <span className="flex items-center gap-2">
                                    <RealmIcon iconKey={value} className="size-4" />
                                    {label}
                                </span>
                            ),
                        }))}
                    />
                </Form.Item>
                <Form.Item noStyle shouldUpdate>
                    {() => {
                        const color = cultivationAccentColor(form.getFieldValue("color") || realm?.color || "#38bdf8");
                        const iconKey = form.getFieldValue("iconKey") || realm?.iconKey || "Sparkles";
                        const name = form.getFieldValue("name") || realm?.name || "境界名称";
                        return (
                            <div className="cultivation-realm-preview" style={{ "--cultivation-admin-accent": color } as CSSProperties}>
                                <RealmIcon iconKey={iconKey} className="size-5" />
                                <span>{name}</span>
                            </div>
                        );
                    }}
                </Form.Item>
                <div className="mt-5 grid grid-cols-2 gap-3">
                    <Form.Item label="每日生图额度" name="dailyLimit" extra="留空则不限次数">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item label="最大并发任务" name="maxConcurrency" extra="同一用户同时运行的任务数">
                        <InputNumber min={1} className="w-full" />
                    </Form.Item>
                </div>
                <Form.Item label="升级策略" name="promotionPolicy">
                    <Select options={promotionPolicyOptions} />
                </Form.Item>
                <Form.Item label="突破反馈" name="animationPreset">
                    <div className="flex gap-2">
                        <Select className="min-w-0 flex-1" options={animationOptions} />
                        <Tooltip title="预览用户看到的突破反馈">
                            <Button icon={<Eye className="size-4" />} onClick={preview} aria-label="预览突破反馈" />
                        </Tooltip>
                    </div>
                </Form.Item>
                <Form.Item label="修改原因" name="reason" rules={[{ required: true, min: 2, message: "请填写修改原因" }]}>
                    <Input.TextArea rows={2} maxLength={300} showCount />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function StageDrawer({ stage, capabilities, onClose, onSubmit }: { stage: CultivationStageConfig | null; capabilities: CultivationConfiguration["capabilities"]; onClose: () => void; onSubmit: (values: StageFormValues) => void }) {
    const [form] = Form.useForm<StageFormValues>();
    const [dirty, setDirty] = useState(false);
    const capabilityOptions = useMemo(
        () => groupCapabilities(capabilities).map(([category, items]) => ({ label: capabilityCategoryLabel(category), options: items.map((capability) => ({ value: capability.key, label: capability.label })) })),
        [capabilities],
    );
    const requestClose = () => {
        if (!dirty) return onClose();
        confirmDiscard(onClose);
    };
    return (
        <Drawer
            title="编辑阶段规则"
            open={Boolean(stage)}
            width={500}
            rootClassName="cultivation-admin-drawer"
            onClose={requestClose}
            destroyOnHidden
            afterOpenChange={(open) => {
                if (!open || !stage) return;
                form.setFieldsValue({ ...stage, reason: "" });
                setDirty(false);
            }}
            footer={<DrawerFooter dirty={dirty} onCancel={requestClose} onSave={() => form.validateFields().then(onSubmit)} />}
        >
            <p className="cultivation-drawer-intro">这里定义阶段的修为阈值和已开放能力，能力总开关在“奖励与能力”中统一管理。</p>
            <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                <Form.Item label="阶段名称" name="name" rules={[{ required: true, message: "请输入阶段名称" }]}>
                    <Input maxLength={32} />
                </Form.Item>
                <div className="grid grid-cols-2 gap-3">
                    <Form.Item label="升级所需修为" name="requiredXp" extra="到达此数值后触发升级策略">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item label="启用" name="active" valuePropName="checked" extra="停用后不会分配给新用户">
                        <Switch />
                    </Form.Item>
                </div>
                <Form.Item label="已开放能力" name="capabilities" extra="按能力类别分组，选择后会在对应阶段生效。">
                    <Select mode="multiple" maxTagCount="responsive" options={capabilityOptions} />
                </Form.Item>
                <Form.Item label="修改原因" name="reason" rules={[{ required: true, min: 2, message: "请填写修改原因" }]}>
                    <Input.TextArea rows={2} maxLength={300} showCount />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function RewardEditor({ configuration, onSaved }: { configuration: CultivationConfiguration; onSaved: () => Promise<unknown> | void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<Record<string, number | string>>();
    useEffect(() => form.setFieldsValue({ ...configuration.rewards, reason: "" }), [configuration.rewards, form]);
    return (
        <section className="cultivation-admin-section">
            <div className="cultivation-admin-section-heading">
                <div>
                    <h3>修为奖励</h3>
                    <p>仅在成功生成图片后结算修为；数字单位为“修为 / 成功图片”。</p>
                </div>
            </div>
            <Form
                form={form}
                layout="vertical"
                onFinish={async (values) => {
                    const { reason, ...rewards } = values;
                    try {
                        await updateCultivationRewards(Object.fromEntries(Object.entries(rewards).map(([key, value]) => [key, Number(value) || 0])), String(reason || ""));
                        await onSaved();
                        message.success("奖励配置已保存");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "保存失败");
                    }
                }}
            >
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                        ["xp.standard", "普通生成"],
                        ["xp.hd", "高清生成"],
                        ["xp.inpaint", "局部重绘"],
                        ["xp.outpaint", "扩图"],
                    ].map(([key, label]) => (
                        <Form.Item key={key} label={label} name={key} extra="修为 / 成功图片">
                            <InputNumber min={0} className="w-full" />
                        </Form.Item>
                    ))}
                </div>
                <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Form.Item className="mb-0" label="修改原因" name="reason" rules={[{ required: true, min: 2, message: "请填写修改原因" }]}>
                        <Input maxLength={300} placeholder="说明本次奖励规则调整" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit">
                        保存奖励
                    </Button>
                </div>
            </Form>
        </section>
    );
}

function CapabilityEditor({ configuration, onSaved }: { configuration: CultivationConfiguration; onSaved: () => Promise<unknown> | void }) {
    const { message } = App.useApp();
    const mutation = useMutation({
        mutationFn: ({ key, active, reason }: { key: string; active: boolean; reason: string }) => updateCultivationCapability(key, { active, reason }),
        onSuccess: async () => {
            await onSaved();
            message.success("能力开关已更新");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const groups = useMemo(() => groupCapabilities(configuration.capabilities), [configuration.capabilities]);
    const update = (key: string, active: boolean) => {
        promptReason(active ? "启用能力" : "停用能力", (reason) => mutation.mutate({ key, active, reason }));
    };
    return (
        <section className="cultivation-admin-section">
            <div className="cultivation-admin-section-heading">
                <div>
                    <h3>能力总开关</h3>
                    <p>关闭能力后，所有阶段都会立即失去该能力；不会修改各阶段的能力分配。</p>
                </div>
            </div>
            <div className="space-y-7">
                {groups.map(([category, capabilities]) => (
                    <section key={category} className="cultivation-capability-group">
                        <h4>{capabilityCategoryLabel(category)}</h4>
                        <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
                            {capabilities.map((capability) => (
                                <div key={capability.key} className="cultivation-capability-row">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{capability.label}</span>
                                            <Tooltip title={`能力键：${capability.key}`}>
                                                <Info className="size-3.5 shrink-0 text-stone-400" aria-label={`能力键 ${capability.key}`} />
                                            </Tooltip>
                                        </div>
                                        <div className="mt-1 text-xs text-stone-500">{capability.active ? "当前已对可用阶段开放" : "当前已全局关闭"}</div>
                                    </div>
                                    <Switch checked={capability.active} loading={mutation.isPending && mutation.variables?.key === capability.key} disabled={mutation.isPending} onChange={(checked) => update(capability.key, checked)} />
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </section>
    );
}

function LogsPanel({ onOpenUser }: { onOpenUser: (displayName: string) => void }) {
    return (
        <Tabs
            className="cultivation-admin-tabs cultivation-admin-log-tabs"
            items={[
                { key: "ledger", label: "修为流水", children: <LogPanel kind="ledger" title="修为流水" description="记录奖励、管理员增减与每次结算后的总修为。" onOpenUser={onOpenUser} /> },
                { key: "audit-logs", label: "管理员日志", children: <LogPanel kind="audit-logs" title="管理员日志" description="记录对用户、境界、阶段、能力和奖励规则的修改。" onOpenUser={onOpenUser} /> },
                { key: "login-logs", label: "登录日志", children: <LogPanel kind="login-logs" title="登录日志" description="保留必要的登录结果、设备与脱敏 IP 信息。" onOpenUser={onOpenUser} /> },
                { key: "breakthroughs", label: "突破历史", children: <LogPanel kind="breakthroughs" title="突破历史" description="查看自动突破和管理员审批的历史记录。" onOpenUser={onOpenUser} /> },
            ]}
        />
    );
}

function LogPanel({ kind, title, description, onOpenUser }: { kind: LogKind; title: string; description: string; onOpenUser: (displayName: string) => void }) {
    const [page, setPage] = useState(1);
    const { data, isFetching } = useQuery({ queryKey: ["admin", "cultivation", kind, page], queryFn: () => fetchCultivationLog<LogRow>(kind, page, 20) });
    return (
        <section className="cultivation-admin-panel cultivation-admin-log-panel">
            <div className="cultivation-admin-panel-header">
                <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
            </div>
            <Table<LogRow>
                className="cultivation-admin-table"
                rowKey={(row) => String(row.id || row.job_id || JSON.stringify(row))}
                size="middle"
                loading={isFetching}
                dataSource={data?.items || []}
                scroll={{ x: 900 }}
                pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false, showTotal: (total) => `共 ${total} 条记录` }}
                columns={getLogColumns(kind, onOpenUser)}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" /> }}
            />
        </section>
    );
}

function getLogColumns(kind: LogKind, onOpenUser: (displayName: string) => void): ColumnsType<LogRow> {
    const text = (title: string, key: string, width?: number): ColumnsType<LogRow>[number] => ({
        title,
        dataIndex: key,
        key,
        width,
        ellipsis: true,
        render: (value: unknown) => <span title={formatLogValue(value, key)}>{formatLogValue(value, key)}</span>,
    });
    const number = (title: string, key: string, width?: number): ColumnsType<LogRow>[number] => ({
        title,
        dataIndex: key,
        key,
        width,
        align: "right",
        render: (value: unknown) => <span className="cultivation-count">{formatLogValue(value, key)}</span>,
    });
    const user = (title: string, nameKey: string, idKey: string, width = 150): ColumnsType<LogRow>[number] => ({
        title,
        key: nameKey,
        width,
        ellipsis: true,
        render: (_: unknown, row) => <LogUser value={row[nameKey]} id={row[idKey]} onOpenUser={onOpenUser} />,
    });
    if (kind === "ledger") {
        return [
            user("用户", "display_name", "user_id"),
            {
                title: "修为变化",
                dataIndex: "amount",
                key: "amount",
                width: 110,
                align: "right",
                render: (value: unknown) => (
                    <span className={`cultivation-count ${Number(value) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {Number(value) > 0 ? "+" : ""}
                        {formatLogValue(value, "amount")}
                    </span>
                ),
            },
            number("累计修为", "balance_after", 120),
            { title: "来源", dataIndex: "source_type", key: "source_type", width: 105, render: (value: unknown) => sourceTypeLabel(String(value || "")) },
            text("备注", "reason"),
            text("时间", "created_at", 170),
        ];
    }
    if (kind === "usage") {
        return [
            user("用户", "display_name", "user_id"),
            text("模型", "model", 160),
            number("请求", "requested_count", 86),
            number("成功", "success_count", 86),
            { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value: unknown) => <UsageStatusTag status={String(value || "")} /> },
            { title: "耗时", dataIndex: "duration_ms", key: "duration_ms", width: 110, align: "right", render: (value: unknown) => <span className="cultivation-count">{formatDuration(value)}</span> },
            { title: "任务", dataIndex: "job_id", key: "job_id", width: 108, render: (value: unknown) => <ShortId value={value} /> },
            text("创建时间", "created_at", 170),
        ];
    }
    if (kind === "audit-logs") {
        return [
            user("管理员", "admin_name", "admin_user_id"),
            { title: "操作", dataIndex: "action", key: "action", width: 190, render: (value: unknown) => auditActionLabel(String(value || "")) },
            user("目标用户", "target_name", "target_user_id"),
            text("原因", "reason"),
            text("时间", "created_at", 170),
        ];
    }
    if (kind === "login-logs") {
        return [
            user("用户", "display_name", "user_id"),
            { title: "结果", dataIndex: "result", key: "result", width: 130, render: (value: unknown) => loginResultLabel(String(value || "")) },
            text("IP", "ip_display", 130),
            text("设备", "user_agent", 260),
            text("时间", "created_at", 170),
        ];
    }
    return [
        user("用户", "display_name", "user_id"),
        text("当前阶段", "from_stage", 150),
        text("目标阶段", "to_stage", 150),
        { title: "状态", dataIndex: "status", key: "status", width: 106, render: (value: unknown) => <BreakthroughStatusTag status={String(value || "")} /> },
        user("审批人", "approved_name", "approved_by", 130),
        text("原因", "reason"),
        text("时间", "created_at", 170),
    ];
}

function UserIdentity({ user, large = false }: { user: Pick<AdminCultivationUser, "displayName" | "userId" | "avatarUrl">; large?: boolean }) {
    const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "U";
    return (
        <div className={`cultivation-user-identity ${large ? "is-large" : ""}`}>
            <div className="cultivation-user-avatar">
                <span>{initial}</span>
                {user.avatarUrl ? (
                    <img
                        src={user.avatarUrl}
                        alt=""
                        width={large ? 40 : 32}
                        height={large ? 40 : 32}
                        onError={(event) => {
                            event.currentTarget.hidden = true;
                        }}
                    />
                ) : null}
            </div>
            <div className="min-w-0">
                <div className="truncate font-medium text-stone-900 dark:text-stone-100">{user.displayName}</div>
                <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400" title={user.userId}>
                    UID {user.userId.slice(0, 8)}
                </div>
            </div>
        </div>
    );
}

function RealmBadge({ user }: { user: Pick<AdminCultivationUser, "realmName" | "stageName" | "color" | "iconKey"> }) {
    const accent = cultivationAccentColor(user.color);
    return (
        <span className="cultivation-realm-badge" style={{ "--cultivation-admin-accent": accent } as CSSProperties} title={cultivationStageLabel(user.realmName, user.stageName)}>
            <RealmIcon iconKey={user.iconKey} className="size-3.5 shrink-0" />
            <span className="truncate">{cultivationStageLabel(user.realmName, user.stageName)}</span>
        </span>
    );
}

function RealmConfigIdentity({ realm }: { realm: CultivationRealmConfig }) {
    const accent = cultivationAccentColor(realm.color);
    return (
        <div className="flex min-w-0 items-center gap-2.5" style={{ "--cultivation-admin-accent": accent } as CSSProperties}>
            <span className="cultivation-realm-symbol">
                <RealmIcon iconKey={realm.iconKey} className="size-4" />
            </span>
            <div className="min-w-0">
                <div className="truncate font-medium text-stone-900 dark:text-stone-100">{realm.name}</div>
                <div className="mt-1 truncate text-xs text-stone-500">{realm.code}</div>
            </div>
        </div>
    );
}

function AccountStatusTag({ status }: { status: string }) {
    const detail = accountStatusOptions.find((option) => option.value === status);
    return <Tag color={status === "NORMAL" ? "green" : status === "BANNED" ? "red" : "orange"}>{detail?.label || status}</Tag>;
}

function UsageStatusTag({ status }: { status: string }) {
    const labels: Record<string, { label: string; color?: string }> = {
        reserved: { label: "生成中", color: "processing" },
        settled: { label: "已结算", color: "green" },
        refunded: { label: "已退回", color: "orange" },
    };
    const item = labels[status] || { label: status || "未知" };
    return <Tag color={item.color}>{item.label}</Tag>;
}

function BreakthroughStatusTag({ status }: { status: string }) {
    const labels: Record<string, { label: string; color?: string }> = {
        pending: { label: "待审批", color: "gold" },
        approved: { label: "已批准", color: "green" },
        automatic: { label: "自动突破", color: "blue" },
    };
    const item = labels[status] || { label: status || "未知" };
    return <Tag color={item.color}>{item.label}</Tag>;
}

function LogUser({ value, id, onOpenUser }: { value: unknown; id: unknown; onOpenUser: (displayName: string) => void }) {
    const name = String(value || "").trim();
    if (name)
        return (
            <button type="button" className="cultivation-log-user" onClick={() => onOpenUser(name)}>
                {name}
            </button>
        );
    return <ShortId value={id} />;
}

function ShortId({ value }: { value: unknown }) {
    const id = String(value || "").trim();
    return id ? (
        <span className="font-mono text-xs text-stone-500 dark:text-stone-400" title={id}>
            {id.slice(0, 8)}
        </span>
    ) : (
        <span className="text-stone-400">-</span>
    );
}

function DrawerFooter({ dirty, onCancel, onSave }: { dirty: boolean; onCancel: () => void; onSave: () => void }) {
    return (
        <div className="cultivation-drawer-footer">
            <span>{dirty ? "有未保存的更改" : "修改会写入审计日志"}</span>
            <div className="flex gap-2">
                <Button onClick={onCancel}>取消</Button>
                <Button type="primary" onClick={onSave}>
                    保存更改
                </Button>
            </div>
        </div>
    );
}

function formatLogValue(value: unknown, key: string): string {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number") {
        if (key.endsWith("_at")) return new Date(value).toLocaleString("zh-CN", { hour12: false });
        return value.toLocaleString("zh-CN");
    }
    return String(value);
}

function formatDuration(value: unknown) {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "-";
    return milliseconds >= 60_000 ? `${(milliseconds / 60_000).toFixed(1)} 分` : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function sourceTypeLabel(value: string) {
    return ({ generation: "图片生成", admin: "管理员调整" } as Record<string, string>)[value] || value || "-";
}

function auditActionLabel(value: string) {
    return (
        (
            {
                "cultivation.user.update": "更新用户修炼信息",
                "cultivation.breakthrough.approve": "批准突破",
                "cultivation.realm.update": "更新境界规则",
                "cultivation.stage.update": "更新阶段规则",
                "cultivation.capability.update": "更新能力开关",
                "cultivation.rewards.update": "更新修为奖励",
            } as Record<string, string>
        )[value] ||
        value ||
        "-"
    );
}

function loginResultLabel(value: string) {
    return (
        (
            {
                success: "登录成功",
                "setup-success": "初始化成功",
                disabled: "账号已停用",
                "invalid-access-code": "访问口令错误",
                "invalid-personal-code": "个人密码错误",
            } as Record<string, string>
        )[value] ||
        value ||
        "-"
    );
}

function promotionPolicyLabel(value: CultivationRealmConfig["promotionPolicy"]) {
    return promotionPolicyOptions.find((option) => option.value === value)?.label || value;
}

function capabilityCategoryLabel(category: string) {
    return ({ generation: "生成控制", model: "模型权限", feature: "创作工具" } as Record<string, string>)[category] || category;
}

function groupCapabilities(capabilities: CultivationConfiguration["capabilities"]) {
    const groups = new Map<string, CultivationConfiguration["capabilities"]>();
    for (const capability of capabilities) groups.set(capability.category, [...(groups.get(capability.category) || []), capability]);
    return Array.from(groups.entries());
}

function confirmDiscard(onConfirm: () => void) {
    Modal.confirm({
        title: "放弃未保存的更改？",
        icon: null,
        content: "关闭后，本次修改不会被保存。",
        okText: "放弃更改",
        cancelText: "继续编辑",
        onOk: onConfirm,
    });
}

interface ReasonFormHandle {
    validate: () => Promise<string>;
}

const ReasonFormContent = forwardRef<ReasonFormHandle, object>(function ReasonFormContent(_, ref) {
    const [form] = Form.useForm<{ reason: string }>();
    useImperativeHandle(ref, () => ({ validate: () => form.validateFields().then((values) => values.reason.trim()) }));
    return (
        <Form form={form} layout="vertical" className="mt-3">
            <Form.Item
                name="reason"
                rules={[
                    { required: true, message: "请填写操作原因" },
                    { min: 2, message: "原因至少需要 2 个字符" },
                ]}
            >
                <Input.TextArea autoFocus rows={3} maxLength={300} showCount placeholder="请输入操作原因" />
            </Form.Item>
        </Form>
    );
});

function promptReason(title: string, onConfirm: (reason: string) => void | Promise<unknown>) {
    const contentRef = createRef<ReasonFormHandle>();
    Modal.confirm({
        title,
        icon: null,
        content: <ReasonFormContent ref={contentRef} />,
        okText: "确认",
        cancelText: "取消",
        onOk: async () => {
            if (!contentRef.current) return Promise.reject();
            const reason = await contentRef.current.validate();
            await onConfirm(reason);
        },
    });
}

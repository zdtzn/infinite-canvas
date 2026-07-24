import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Result, Select, Switch, Table, Tabs, Tag } from "antd";
import { Check, Edit3, RefreshCw, Sparkles } from "lucide-react";
import { createRef, forwardRef, useImperativeHandle, useMemo, useState } from "react";

import { previewCultivationBreakthrough } from "@/features/cultivation/breakthrough-overlay";
import { cultivationStageLabel } from "@/features/cultivation/utils";
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

export default function AdminCultivationPage() {
    const admin = useUserStore((state) => Boolean(state.user?.admin));
    const { data: configuration, isLoading: configurationLoading } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration, enabled: admin });
    const previewBreakthrough = () => {
        const realm = configuration?.realms.find((item) => item.active && item.stages.filter((stage) => stage.active).length > 1);
        const stages = realm?.stages.filter((stage) => stage.active) || [];
        if (!realm || stages.length < 2) return;
        previewCultivationBreakthrough({
            fromStageName: `${realm.name} ${stages[0].name}`,
            toStageName: `${realm.name} ${stages[1].name}`,
            animationPreset: realm.animationPreset,
        });
    };
    if (!admin) return <Result status="403" title="无权访问" subTitle="只有管理员可以进入修炼管理。" />;
    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-7xl px-6 py-8">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <div className="text-sm text-stone-500">后台管理</div>
                        <h1 className="mt-1 text-2xl font-semibold">修炼管理</h1>
                    </div>
                    <Button icon={<Sparkles className="size-4" />} disabled={configurationLoading || !configuration?.realms.some((realm) => realm.active && realm.stages.filter((stage) => stage.active).length > 1)} onClick={previewBreakthrough}>
                        预览突破动效
                    </Button>
                </header>
                <Tabs
                    items={[
                        { key: "users", label: "用户", children: <UsersPanel /> },
                        { key: "config", label: "配置", children: <ConfigurationPanel /> },
                        { key: "usage", label: "用量", children: <LogPanel kind="usage" /> },
                        { key: "logs", label: "日志", children: <LogsPanel /> },
                    ]}
                />
            </div>
        </main>
    );
}

function UsersPanel() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<(CultivationProfile & { status: string }) | null>(null);
    const { data, isFetching } = useQuery({ queryKey: ["admin", "cultivation", "users", page, search], queryFn: () => fetchAdminCultivationUsers(page, 20, search) });
    const { data: config } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });
    const mutation = useMutation({
        mutationFn: ({ userId, values }: { userId: string; values: Record<string, unknown> }) => updateAdminCultivationUser(userId, values),
        onSuccess: () => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "users"] });
            void queryClient.invalidateQueries({ queryKey: ["cultivation", "profile"] });
            message.success("用户修炼信息已更新");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const approve = useMutation({
        mutationFn: ({ userId, reason }: { userId: string; reason: string }) => approveAdminBreakthrough(userId, reason),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "users"] });
            message.success("突破已批准");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "审批失败"),
    });
    const stageOptions = useMemo(() => config?.realms.flatMap((realm) => realm.stages.map((stage) => ({ value: stage.id, label: cultivationStageLabel(realm.name, stage.name) }))) || [], [config]);
    return (
        <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <Input.Search
                    allowClear
                    placeholder="搜索昵称"
                    className="max-w-xs"
                    onSearch={(value) => {
                        setSearch(value);
                        setPage(1);
                    }}
                />
                <Button icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "users"] })}>
                    刷新
                </Button>
            </div>
            <Table
                rowKey="userId"
                loading={isFetching}
                dataSource={data?.items || []}
                pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false }}
                columns={[
                    { title: "用户", dataIndex: "displayName", ellipsis: true },
                    {
                        title: "境界",
                        render: (_, row) => <span style={{ color: row.color }}>{cultivationStageLabel(row.realmName, row.stageName)}</span>,
                        ellipsis: true,
                        responsive: ["sm"],
                    },
                    { title: "修为", render: (_, row) => `${row.currentXp} / ${row.requiredXp}`, responsive: ["lg"] },
                    { title: "今日额度", render: (_, row) => (row.unlimited ? "不限" : `${row.usedToday}/${row.dailyLimit}`), responsive: ["md"] },
                    { title: "累计图片", dataIndex: "totalImages", responsive: ["xl"] },
                    { title: "状态", render: (_, row) => <Tag color={row.status === "NORMAL" ? "success" : "error"}>{row.status}</Tag>, responsive: ["xl"] },
                    {
                        title: "突破",
                        render: (_, row) =>
                            row.pendingStageId ? (
                                <Button size="small" icon={<Check className="size-3.5" />} onClick={() => promptReason("批准突破", (reason) => approve.mutate({ userId: row.userId, reason }))}>
                                    批准
                                </Button>
                            ) : (
                                "-"
                            ),
                        responsive: ["xl"],
                    },
                    {
                        title: "操作",
                        width: 76,
                        render: (_, row) => (
                            <Button type="text" icon={<Edit3 className="size-4" />} onClick={() => setEditing(row)}>
                                编辑
                            </Button>
                        ),
                    },
                ]}
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
    user: (CultivationProfile & { status: string }) | null;
    stageOptions: Array<{ value: string; label: string }>;
    loading: boolean;
    onClose: () => void;
    onSubmit: (values: Record<string, unknown>) => void;
}) {
    const [form] = Form.useForm();
    return (
        <Drawer
            title="调整用户"
            open={Boolean(user)}
            width={460}
            onClose={onClose}
            destroyOnHidden
            afterOpenChange={(open) => {
                if (open && user)
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
            }}
            extra={
                <Button type="primary" loading={loading} onClick={() => form.validateFields().then(onSubmit)}>
                    保存
                </Button>
            }
        >
            <Form form={form} layout="vertical">
                <Form.Item label="境界与阶段" name="stageId">
                    <Select showSearch optionFilterProp="label" options={stageOptions} />
                </Form.Item>
                <div className="grid grid-cols-2 gap-3">
                    <Form.Item label="当前阶段修为" name="currentXp">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item label="修为增减" name="xpDelta">
                        <InputNumber className="w-full" />
                    </Form.Item>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Form.Item label="每日次数覆盖" name="dailyLimitOverride" extra="留空则继承当前境界">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item label="不限次数" name="unlimited" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </div>
                <Form.Item label="账号状态" name="status">
                    <Select options={["NORMAL", "DISABLED", "BANNED"].map((value) => ({ value, label: value }))} />
                </Form.Item>
                <Form.Item label="内部备注" name="internalNote">
                    <Input.TextArea rows={3} maxLength={500} />
                </Form.Item>
                <Form.Item label="公开留言" name="publicMessage">
                    <Input.TextArea rows={3} maxLength={500} />
                </Form.Item>
                <Form.Item label="调整原因" name="reason" rules={[{ required: true, min: 2, message: "请填写调整原因" }]}>
                    <Input.TextArea rows={2} maxLength={300} />
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
    if (!data) return isLoading ? <div className="py-12 text-center text-stone-500">正在加载配置...</div> : <Empty />;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "config"] });
    const saveRealm = async (values: Record<string, unknown>) => {
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
    const saveStage = async (values: Record<string, unknown>) => {
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
        <section className="space-y-8">
            <Table
                rowKey="id"
                pagination={false}
                dataSource={data.realms}
                scroll={{ x: 900 }}
                columns={[
                    { title: "境界", dataIndex: "name", width: 140 },
                    { title: "每日次数", render: (_, row) => (row.dailyLimit === null ? "不限" : row.dailyLimit), width: 100 },
                    { title: "并发", dataIndex: "maxConcurrency", width: 80 },
                    { title: "升级策略", dataIndex: "promotionPolicy", width: 150 },
                    {
                        title: "颜色",
                        render: (_, row) => (
                            <span className="inline-flex items-center gap-2">
                                <span className="size-4 rounded-sm border" style={{ background: row.color }} title={row.color} />
                            </span>
                        ),
                        width: 130,
                    },
                    { title: "阶段数", render: (_, row) => row.stages.length, width: 90 },
                    {
                        title: "操作",
                        render: (_, row) => (
                            <Button type="text" icon={<Edit3 className="size-4" />} onClick={() => setRealm(row)}>
                                编辑
                            </Button>
                        ),
                    },
                ]}
            />
            <Table
                rowKey="id"
                pagination={{ pageSize: 20 }}
                dataSource={data.realms.flatMap((item) => item.stages.map((entry) => ({ ...entry, realmName: item.name })))}
                columns={[
                    { title: "境界", dataIndex: "realmName" },
                    { title: "阶段", dataIndex: "name" },
                    { title: "升级修为", dataIndex: "requiredXp" },
                    { title: "能力数", render: (_, row) => row.capabilities.length },
                    {
                        title: "操作",
                        render: (_, row) => (
                            <Button type="text" icon={<Edit3 className="size-4" />} onClick={() => setStage(row)}>
                                编辑
                            </Button>
                        ),
                    },
                ]}
            />
            <RewardEditor configuration={data} onSaved={refresh} />
            <CapabilityEditor configuration={data} onSaved={refresh} />
            <RealmDrawer realm={realm} onClose={() => setRealm(null)} onSubmit={saveRealm} />
            <StageDrawer stage={stage} capabilities={data.capabilities.map((item) => ({ value: item.key, label: item.label }))} onClose={() => setStage(null)} onSubmit={saveStage} />
        </section>
    );
}

function RealmDrawer({ realm, onClose, onSubmit }: { realm: CultivationRealmConfig | null; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void }) {
    const [form] = Form.useForm();
    return (
        <Drawer
            title="编辑境界"
            open={Boolean(realm)}
            width={440}
            onClose={onClose}
            destroyOnHidden
            afterOpenChange={(open) => open && realm && form.setFieldsValue({ ...realm, reason: "" })}
            extra={
                <Button type="primary" onClick={() => form.validateFields().then(onSubmit)}>
                    保存
                </Button>
            }
        >
            <Form form={form} layout="vertical">
                <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                    <Input />
                </Form.Item>
                <Form.Item label="颜色" name="color">
                    <Input type="color" className="h-10 p-1" />
                </Form.Item>
                <Form.Item label="图标键" name="iconKey">
                    <Input />
                </Form.Item>
                <Form.Item label="每日次数（留空为不限）" name="dailyLimit">
                    <InputNumber min={0} className="w-full" />
                </Form.Item>
                <Form.Item label="最大并发" name="maxConcurrency">
                    <InputNumber min={1} className="w-full" />
                </Form.Item>
                <Form.Item label="升级策略" name="promotionPolicy">
                    <Select
                        options={[
                            { value: "auto", label: "全自动" },
                            { value: "manual", label: "全人工" },
                            { value: "boundary_manual", label: "同一境界内自动、跨境界审批" },
                        ]}
                    />
                </Form.Item>
                <Form.Item label="动画预设" name="animationPreset">
                    <Select options={["minimal-line", "soft-flare", "digital-ring"].map((value) => ({ value, label: value }))} />
                </Form.Item>
                <Form.Item label="修改原因" name="reason" rules={[{ required: true, min: 2 }]}>
                    <Input.TextArea rows={2} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function StageDrawer({ stage, capabilities, onClose, onSubmit }: { stage: CultivationStageConfig | null; capabilities: Array<{ value: string; label: string }>; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void }) {
    const [form] = Form.useForm();
    return (
        <Drawer
            title="编辑阶段"
            open={Boolean(stage)}
            width={440}
            onClose={onClose}
            destroyOnHidden
            afterOpenChange={(open) => open && stage && form.setFieldsValue({ ...stage, reason: "" })}
            extra={
                <Button type="primary" onClick={() => form.validateFields().then(onSubmit)}>
                    保存
                </Button>
            }
        >
            <Form form={form} layout="vertical">
                <Form.Item label="名称" name="name">
                    <Input />
                </Form.Item>
                <Form.Item label="升级所需修为" name="requiredXp">
                    <InputNumber min={0} className="w-full" />
                </Form.Item>
                <Form.Item label="能力" name="capabilities">
                    <Select mode="multiple" options={capabilities} />
                </Form.Item>
                <Form.Item label="启用" name="active" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Form.Item label="修改原因" name="reason" rules={[{ required: true, min: 2 }]}>
                    <Input.TextArea rows={2} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function RewardEditor({ configuration, onSaved }: { configuration: CultivationConfiguration; onSaved: () => Promise<unknown> | void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    return (
        <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
            <h2 className="mb-4 text-base font-semibold">修为奖励</h2>
            <Form
                form={form}
                layout="vertical"
                initialValues={{ ...configuration.rewards, reason: "" }}
                onFinish={async (values) => {
                    const { reason, ...rewards } = values;
                    try {
                        await updateCultivationRewards(rewards, reason);
                        await onSaved();
                        message.success("奖励配置已保存");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "保存失败");
                    }
                }}
            >
                <div className="grid gap-3 md:grid-cols-4">
                    {[
                        ["xp.standard", "普通生成"],
                        ["xp.hd", "高清生成"],
                        ["xp.inpaint", "局部重绘"],
                        ["xp.outpaint", "扩图"],
                    ].map(([key, label]) => (
                        <Form.Item key={key} label={label} name={key}>
                            <InputNumber min={0} className="w-full" />
                        </Form.Item>
                    ))}
                </div>
                <Form.Item label="修改原因" name="reason" rules={[{ required: true, min: 2 }]}>
                    <Input />
                </Form.Item>
                <Button type="primary" htmlType="submit">
                    保存奖励
                </Button>
            </Form>
        </section>
    );
}

function CapabilityEditor({ configuration, onSaved }: { configuration: CultivationConfiguration; onSaved: () => Promise<unknown> | void }) {
    const { message } = App.useApp();
    const update = (key: string, active: boolean) => {
        promptReason(active ? "启用能力" : "停用能力", async (reason) => {
            try {
                await updateCultivationCapability(key, { active, reason });
                await onSaved();
                message.success("能力开关已更新");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "更新失败");
            }
        });
    };
    return (
        <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
            <h2 className="mb-4 text-base font-semibold">能力总开关</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {configuration.capabilities.map((capability) => (
                    <div key={capability.key} className="flex items-center justify-between gap-3 border-b border-stone-200 py-2 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{capability.label}</div>
                            <div className="truncate text-xs text-stone-400">{capability.key}</div>
                        </div>
                        <Switch checked={capability.active} onChange={(checked) => update(capability.key, checked)} />
                    </div>
                ))}
            </div>
        </section>
    );
}

function LogsPanel() {
    return (
        <Tabs
            type="card"
            items={[
                { key: "ledger", label: "修为流水", children: <LogPanel kind="ledger" /> },
                { key: "audit-logs", label: "管理员日志", children: <LogPanel kind="audit-logs" /> },
                { key: "login-logs", label: "登录日志", children: <LogPanel kind="login-logs" /> },
                { key: "breakthroughs", label: "突破历史", children: <LogPanel kind="breakthroughs" /> },
            ]}
        />
    );
}

function formatLogValue(value: unknown, key: string): string {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number") {
        if (key.endsWith("_at")) return new Date(value).toLocaleString("zh-CN", { hour12: false });
        return value.toLocaleString("zh-CN");
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function getLogColumns(kind: string) {
    const col = (title: string, key: string, width?: number) => ({
        title,
        dataIndex: key,
        key,
        width,
        ellipsis: true,
        render: (value: unknown) => formatLogValue(value, key),
    });

    if (kind === "ledger") {
        return [
            col("用户", "display_name", 130),
            col("修为变化", "delta", 100),
            col("余额", "balance_after", 100),
            col("来源", "source", 120),
            col("备注", "note"),
            col("时间", "created_at", 160),
        ];
    }
    if (kind === "usage") {
        return [
            col("用户", "display_name", 130),
            col("操作", "action", 130),
            col("图片数", "images", 80),
            col("任务", "job_id"),
            col("时间", "created_at", 160),
        ];
    }
    if (kind === "audit-logs") {
        return [
            col("管理员", "admin_name", 130),
            col("操作", "action", 150),
            col("目标用户", "target_name", 130),
            col("原因", "reason"),
            col("时间", "created_at", 160),
        ];
    }
    if (kind === "login-logs") {
        return [
            col("用户", "display_name", 130),
            col("方式", "method", 100),
            col("时间", "created_at", 160),
        ];
    }
    if (kind === "breakthroughs") {
        return [
            col("用户", "display_name", 130),
            col("当前境界", "from_stage", 130),
            col("目标境界", "to_stage", 130),
            col("状态", "status", 90),
            col("审批人", "approved_by", 110),
            col("原因", "reason"),
            col("时间", "created_at", 160),
        ];
    }
    // Unknown kind: render all non-internal fields as a single summary cell
    return [
        {
            title: "内容",
            key: "fallback",
            render: (_: unknown, row: Record<string, unknown>) =>
                Object.entries(row)
                    .filter(([k]) => !k.endsWith("_json") && k !== "ip_hash")
                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                    .join(" | "),
        },
    ];
}

function LogPanel({ kind }: { kind: "ledger" | "usage" | "audit-logs" | "login-logs" | "breakthroughs" }) {
    const [page, setPage] = useState(1);
    const { data, isFetching } = useQuery({ queryKey: ["admin", "cultivation", kind, page], queryFn: () => fetchCultivationLog<Record<string, unknown>>(kind, page, 20) });
    return (
        <Table
            rowKey={(row) => String(row.id || row.job_id || JSON.stringify(row))}
            loading={isFetching}
            dataSource={data?.items || []}
            scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false }}
            columns={getLogColumns(kind)}
        />
    );
}

interface ReasonFormHandle {
    validate: () => Promise<string>;
}

const ReasonFormContent = forwardRef<ReasonFormHandle, object>(function ReasonFormContent(_, ref) {
    const [form] = Form.useForm<{ reason: string }>();
    useImperativeHandle(ref, () => ({
        validate: () => form.validateFields().then((values) => values.reason.trim()),
    }));
    return (
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <Form.Item
                name="reason"
                rules={[
                    { required: true, message: "请填写操作原因" },
                    { min: 5, message: "原因至少需要5个字符" },
                ]}
            >
                <Input.TextArea autoFocus rows={3} placeholder="请输入操作原因" />
            </Form.Item>
        </Form>
    );
});

function promptReason(title: string, onConfirm: (reason: string) => void) {
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
            onConfirm(reason);
        },
    });
}

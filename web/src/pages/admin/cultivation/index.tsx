import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Result, Segmented, Select, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    Activity,
    ArrowLeft,
    ArrowUpRight,
    Bell,
    BookOpenCheck,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    CircleGauge,
    Database,
    Edit3,
    Eye,
    LayoutDashboard,
    RefreshCw,
    ScrollText,
    Search,
    ServerCog,
    Settings2,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    Users,
} from "lucide-react";
import { createRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { previewCultivationBreakthrough } from "@/features/cultivation/breakthrough-overlay";
import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationRealmHero } from "@/features/cultivation/realm-hero";
import { cultivationAccentColor, cultivationStageLabel } from "@/features/cultivation/utils";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { formatBytes } from "@/lib/image-utils";
import {
    fetchAdminChannelMetrics,
    fetchAdminCultivationUsers,
    fetchAdminMetrics,
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
    type AdminChannelMetric,
    type AdminMetrics,
} from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { resolveAdminRecordKind, resolveAdminSection, type AdminRecordKind, type AdminSectionKey } from "./navigation";
import { buildCultivationUserPatch, type CultivationUserFormValues, type CultivationUserPatch } from "./user-update";
import "./admin.css";

type AdminCultivationUser = CultivationProfile & { status: string };
type UserFormValues = CultivationUserFormValues;
type RealmFormValues = {
    name: string;
    color: string;
    iconKey: string;
    dailyLimit?: number | null;
    maxConcurrency?: number;
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
type LogKind = AdminRecordKind;
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

const adminSections = [
    { key: "overview", group: "运营中枢", label: "总览", title: "运营总览", description: "集中查看用户规模、任务状态、渠道健康和最近管理变更。", icon: LayoutDashboard },
    { key: "users", group: "修炼体系", label: "用户管理", title: "用户管理", description: "查看并调整用户境界、修为、额度与账号状态。", icon: Users },
    { key: "rules", group: "修炼体系", label: "成长规则", title: "成长规则", description: "按境界查看阶段进度、升级阈值和突破反馈。", icon: BookOpenCheck },
    { key: "capabilities", group: "修炼体系", label: "能力与额度", title: "能力与额度", description: "维护修为奖励、能力总开关和各境界默认额度。", icon: ShieldCheck },
    { key: "monitoring", group: "系统管理", label: "运行监控", title: "运行监控", description: "检查渠道成功率、任务运行状态、备份和资源清理。", icon: Activity },
    { key: "records", group: "系统管理", label: "记录中心", title: "记录中心", description: "统一查询生成用量、修为流水、管理操作和登录记录。", icon: ScrollText },
] as const satisfies ReadonlyArray<{ key: AdminSectionKey; group: string; label: string; title: string; description: string; icon: typeof LayoutDashboard }>;

export default function AdminCultivationPage() {
    const account = useUserStore((state) => state.user);
    const admin = Boolean(account?.admin);
    const [searchParams, setSearchParams] = useSearchParams();
    const activeSection = resolveAdminSection(searchParams.get("tab"));
    const activeRecordKind = resolveAdminRecordKind(searchParams.get("record"));
    const section = adminSections.find((item) => item.key === activeSection) || adminSections[0];

    const updateParams = (updates: Record<string, string | null>) => {
        const next = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setSearchParams(next, { replace: true });
    };

    const selectSection = (key: AdminSectionKey) =>
        updateParams({
            tab: key === "overview" ? null : key,
            search: key === "users" ? searchParams.get("search") : null,
            record: key === "records" ? searchParams.get("record") : null,
            user: key === "records" ? searchParams.get("user") : null,
        });
    const openUserFromLog = (displayName: string) => updateParams({ tab: "users", search: displayName, record: null, user: null });

    if (!admin) return <Result status="403" title="无权访问" subTitle="只有管理员可以进入修炼管理。" />;

    return (
        <main className="cultivation-admin-page h-full min-h-0 overflow-hidden bg-background">
            <div className="cultivation-admin-shell">
                <aside className="cultivation-admin-sidebar">
                    <div className="cultivation-admin-brand">
                        <div className="cultivation-admin-brand-mark" aria-hidden="true">
                            <Sparkles className="size-5" />
                        </div>
                        <div className="cultivation-admin-brand-copy">
                            <p>INFINITE CANVAS</p>
                            <strong className="font-brush">掌教殿</strong>
                            <span>修炼管理中枢</span>
                        </div>
                    </div>
                    <nav className="cultivation-admin-nav" aria-label="掌教殿管理导航">
                        {adminSections.map((item) => {
                            const Icon = item.icon;
                            const selected = item.key === activeSection;
                            return (
                                <div key={item.key}>
                                    {item.key === "overview" || item.key === "users" || item.key === "monitoring" ? <p className="cultivation-admin-nav-group">{item.group}</p> : null}
                                    <button type="button" className={selected ? "is-active" : ""} aria-current={selected ? "page" : undefined} onClick={() => selectSection(item.key)}>
                                        <Icon className="size-4" aria-hidden="true" />
                                        <span>{item.label}</span>
                                        <ChevronRight className="ml-auto size-3.5" aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })}
                    </nav>
                    <div className="cultivation-admin-sidebar-status">
                        <span className="cultivation-admin-status-dot" />
                        <div>
                            <strong>系统运行正常</strong>
                            <span>管理权限已验证</span>
                        </div>
                    </div>
                    <Link to="/cultivation" className="cultivation-admin-back-link">
                        <ArrowLeft className="size-4" aria-hidden="true" />
                        返回我的修炼
                    </Link>
                </aside>

                <div className="cultivation-admin-workspace">
                    <div className="cultivation-admin-topbar">
                        <div className="cultivation-admin-context">
                            <span className="cultivation-admin-context-icon">
                                <ServerCog className="size-4" aria-hidden="true" />
                            </span>
                            <div>
                                <strong>后台管理中枢</strong>
                                <span>实时掌控修炼体系与系统运行</span>
                            </div>
                        </div>
                        <div className="cultivation-admin-topbar-actions">
                            <div className="cultivation-admin-command-search" aria-label="后台搜索">
                                <Search className="size-4" aria-hidden="true" />
                                <span>搜索用户、规则或记录</span>
                                <kbd>Ctrl K</kbd>
                            </div>
                            <span className="cultivation-admin-icon-button" role="img" aria-label="通知状态" title="通知状态">
                                <Bell className="size-4" aria-hidden="true" />
                                <span className="cultivation-admin-notification-dot" />
                            </span>
                            <div className="cultivation-admin-operator">
                                <span className="cultivation-admin-operator-avatar">{(account?.displayName || "管").slice(0, 1)}</span>
                                <div>
                                    <strong>{account?.displayName || "系统管理员"}</strong>
                                    <span>掌教管理员</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <header className="cultivation-admin-header">
                        <div className="cultivation-admin-mobile-nav">
                            <Select value={activeSection} aria-label="选择管理区域" options={adminSections.map((item) => ({ value: item.key, label: item.label }))} onChange={(value) => selectSection(value as AdminSectionKey)} />
                        </div>
                        <div>
                            <p className="cultivation-admin-breadcrumb">掌教殿 / {section.label}</p>
                            <h1>{section.title}</h1>
                            <p>{section.description}</p>
                        </div>
                    </header>

                    <div className="cultivation-admin-content">
                        {activeSection === "overview" ? <OverviewPanel onOpenUser={openUserFromLog} onNavigate={selectSection} /> : null}
                        {activeSection === "users" ? <UsersPanel searchFromUrl={searchParams.get("search") || ""} onSearchChange={(search) => updateParams({ search })} /> : null}
                        {activeSection === "rules" ? <GrowthRulesPanel /> : null}
                        {activeSection === "capabilities" ? <CapabilitiesQuotaPanel /> : null}
                        {activeSection === "monitoring" ? <MonitoringPanel /> : null}
                        {activeSection === "records" ? (
                            <RecordsPanel
                                kind={activeRecordKind}
                                userId={searchParams.get("user") || ""}
                                onKindChange={(record) => updateParams({ record: record === "usage" ? null : record })}
                                onUserChange={(user) => updateParams({ user })}
                                onOpenUser={openUserFromLog}
                            />
                        ) : null}
                    </div>
                </div>
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
        mutationFn: ({ userId, values }: { userId: string; values: CultivationUserPatch }) => updateAdminCultivationUser(userId, values),
        onSuccess: () => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation"] });
            void queryClient.invalidateQueries({ queryKey: ["cultivation", "profile"] });
            message.success("用户修炼信息已更新");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const stageOptions = useMemo(
        () =>
            config?.realms
                .filter((realm) => realm.active)
                .map((realm) => ({
                    label: realm.name,
                    options: realm.stages.filter((stage) => stage.active).map((stage) => ({ value: stage.id, label: cultivationStageLabel(realm.name, stage.name) })),
                })) || [],
        [config],
    );

    const columns: ColumnsType<AdminCultivationUser> = [
        {
            title: "用户",
            key: "user",
            width: 180,
            render: (_: unknown, user) => <UserIdentity user={user} />,
        },
        {
            title: "当前境界",
            key: "realm",
            width: 150,
            render: (_: unknown, user) => <RealmBadge user={user} />,
        },
        {
            title: "成长进度",
            key: "xp",
            width: 170,
            render: (_: unknown, user) => <CultivationProgress user={user} />,
        },
        {
            title: "今日额度",
            key: "quota",
            width: 100,
            align: "right",
            render: (_: unknown, user) => <span className="cultivation-count">{user.unlimited ? "不限" : `${user.usedToday}/${user.dailyLimit ?? 0}`}</span>,
        },
        { title: "总作品", dataIndex: "totalImages", key: "totalImages", width: 82, align: "right", render: (value: number) => <span className="cultivation-count">{value.toLocaleString()}</span> },
        { title: "活跃天数", dataIndex: "activeDays", key: "activeDays", width: 84, align: "right", render: (value: number) => <span className="cultivation-count">{value.toLocaleString()}</span> },
        {
            title: "状态",
            key: "status",
            width: 82,
            render: (_: unknown, user) => <AccountStatusTag status={user.status} />,
        },
        {
            title: "",
            key: "actions",
            width: 56,
            fixed: "right",
            render: (_: unknown, user) => (
                <Tooltip title="编辑用户">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<Edit3 className="size-4" />}
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditing(user);
                        }}
                        aria-label={`编辑 ${user.displayName}`}
                    />
                </Tooltip>
            ),
        },
    ];

    return (
        <section className="cultivation-admin-panel">
            <div className="cultivation-admin-panel-header">
                <div>
                    <h2>全部用户</h2>
                    <p>{data ? `共 ${data.total} 位用户，点击任意一行查看和调整。` : "正在读取用户信息…"}</p>
                </div>
                <div className="cultivation-admin-toolbar">
                    <Input.Search
                        allowClear
                        value={searchDraft}
                        placeholder="搜索昵称…"
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
                scroll={{ x: 900 }}
                pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false, showTotal: (total) => `共 ${total} 位用户` }}
                columns={columns}
                onRow={(user) => ({
                    className: "cultivation-admin-clickable-row",
                    tabIndex: 0,
                    onClick: () => setEditing(user),
                    onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setEditing(user);
                        }
                    },
                })}
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
    onSubmit: (values: CultivationUserPatch) => void;
}) {
    const [form] = Form.useForm<UserFormValues>();
    const [dirty, setDirty] = useState(false);
    const [xpMode, setXpMode] = useState<"set" | "adjust">("set");
    const initialValuesRef = useRef<UserFormValues | null>(null);
    const requestClose = () => {
        if (!dirty || loading) return onClose();
        confirmDiscard(onClose);
    };
    const save = async () => {
        const values = await form.validateFields();
        const patch = buildCultivationUserPatch(initialValuesRef.current || values, values);
        if (patch.status && patch.status !== "NORMAL" && patch.status !== user?.status) {
            Modal.confirm({
                title: patch.status === "BANNED" ? "确认封禁该账号？" : "确认停用该账号？",
                icon: null,
                content: "账号将无法继续登录和创建任务。该操作会记录到管理员日志。",
                okText: "确认更改",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => onSubmit(patch),
            });
            return;
        }
        onSubmit(patch);
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
                const initialValues: UserFormValues = {
                    stageId: user.stageId,
                    currentXp: user.currentXp,
                    xpDelta: 0,
                    dailyLimitOverride: user.dailyLimitOverride,
                    unlimited: user.unlimited,
                    status: user.status,
                    internalNote: user.internalNote,
                    publicMessage: user.publicMessage,
                    reason: "",
                };
                initialValuesRef.current = initialValues;
                form.setFieldsValue(initialValues);
                setXpMode("set");
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
                <div className="cultivation-drawer-user-summary">
                    <div className="cultivation-drawer-identity">
                        <UserIdentity user={user} large />
                        <AccountStatusTag status={user.status} />
                    </div>
                    <div className="cultivation-drawer-metrics">
                        <AdminMetric label="当前境界" value={cultivationStageLabel(user.realmName, user.stageName)} />
                        <AdminMetric label="今日用量" value={user.unlimited ? "不限" : `${user.usedToday}/${user.dailyLimit ?? 0}`} />
                        <AdminMetric label="累计作品" value={user.totalImages.toLocaleString()} />
                    </div>
                </div>
            ) : null}
            <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                <section className="cultivation-form-section">
                    <FormSectionHeading title="境界与修为" description="升级仍由系统自动完成，这里只处理管理员手动调整。" />
                    <Form.Item label="境界与阶段" name="stageId">
                        <Select showSearch optionFilterProp="label" options={stageOptions} />
                    </Form.Item>
                    <div className="mb-4">
                        <Segmented
                            size="small"
                            value={xpMode}
                            options={[
                                { value: "set", label: "直接设置" },
                                { value: "adjust", label: "增加或扣除" },
                            ]}
                            onChange={(value) => {
                                const mode = value as "set" | "adjust";
                                setXpMode(mode);
                                if (mode === "set") form.setFieldValue("xpDelta", 0);
                                else form.setFieldValue("currentXp", initialValuesRef.current?.currentXp);
                            }}
                        />
                    </div>
                    {xpMode === "set" ? (
                        <Form.Item label="当前阶段修为" name="currentXp" extra="直接设置当前阶段的进度值">
                            <InputNumber min={0} className="w-full" />
                        </Form.Item>
                    ) : (
                        <Form.Item label="修为增减" name="xpDelta" extra="使用正数奖励，使用负数扣除">
                            <InputNumber className="w-full" />
                        </Form.Item>
                    )}
                </section>

                <section className="cultivation-form-section">
                    <FormSectionHeading title="额度与账号" description="用户覆盖优先于当前境界的默认规则。" />
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item label="每日次数覆盖" name="dailyLimitOverride" extra="留空继承境界规则">
                            <InputNumber min={0} className="w-full" />
                        </Form.Item>
                        <Form.Item label="不限次数" name="unlimited" valuePropName="checked" extra="优先于次数覆盖">
                            <Switch />
                        </Form.Item>
                    </div>
                    <Form.Item label="账号状态" name="status" extra="停用或封禁后，用户不能继续登录和创建任务。">
                        <Select options={accountStatusOptions} />
                    </Form.Item>
                </section>

                <section className="cultivation-form-section">
                    <FormSectionHeading title="备注与留言" description="内部备注仅管理员可见，公开留言显示在用户修炼页面。" />
                    <Form.Item label="内部备注" name="internalNote">
                        <Input.TextArea rows={3} maxLength={500} showCount placeholder="记录管理员内部信息…" />
                    </Form.Item>
                    <Form.Item label="公开留言" name="publicMessage">
                        <Input.TextArea rows={3} maxLength={500} showCount placeholder="填写展示给用户的内容…" />
                    </Form.Item>
                </section>

                <section className="cultivation-form-section">
                    <FormSectionHeading title="变更记录" description="不填写时，审计日志会记录为管理员直接调整。" />
                    <Form.Item className="mb-0" label="调整说明（选填）" name="reason">
                        <Input.TextArea rows={2} maxLength={300} showCount placeholder="补充本次调整的背景…" />
                    </Form.Item>
                </section>
            </Form>
        </Drawer>
    );
}

function GrowthRulesPanel() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });
    const [selectedRealmId, setSelectedRealmId] = useState("");
    const [editingRealm, setEditingRealm] = useState<CultivationRealmConfig | null>(null);
    const [editingStage, setEditingStage] = useState<CultivationStageConfig | null>(null);

    useEffect(() => {
        if (data?.realms.length && !data.realms.some((realm) => realm.id === selectedRealmId)) setSelectedRealmId(data.realms[0].id);
    }, [data?.realms, selectedRealmId]);

    if (!data) return isLoading ? <div className="cultivation-admin-loading">正在加载成长规则…</div> : <Empty description="成长规则暂不可用" />;

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "config"] });
    const saveRealm = async (values: RealmFormValues) => {
        if (!editingRealm) return;
        try {
            await updateCultivationRealm(editingRealm.id, values);
            setEditingRealm(null);
            await refresh();
            message.success("境界配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const saveStage = async (values: StageFormValues) => {
        if (!editingStage) return;
        try {
            await updateCultivationStage(editingStage.id, values);
            setEditingStage(null);
            await refresh();
            message.success("阶段配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const selectedRealm = data.realms.find((realm) => realm.id === selectedRealmId) || data.realms[0];
    const activeStages = selectedRealm?.stages.filter((stage) => stage.active) || [];
    const preview = () => {
        if (!selectedRealm || activeStages.length < 2) return;
        previewCultivationBreakthrough({
            fromStageName: cultivationStageLabel(selectedRealm.name, activeStages[0].name),
            toStageName: cultivationStageLabel(selectedRealm.name, activeStages[1].name),
            animationPreset: selectedRealm.animationPreset,
        });
    };

    return (
        <div className="cultivation-rules-layout">
            <aside className="cultivation-realm-list" aria-label="境界列表">
                <div className="cultivation-realm-list-heading">
                    <span>境界图鉴</span>
                    <span>{data.realms.length}</span>
                </div>
                <div className="cultivation-realm-list-items">
                    {data.realms.map((realm, index) => {
                        const selected = realm.id === selectedRealm?.id;
                        const accent = cultivationAccentColor(realm.color);
                        const activeStageCount = realm.stages.filter((stage) => stage.active).length;
                        const realmHero = cultivationRealmHero(realm.id);
                        return (
                            <button
                                key={realm.id}
                                type="button"
                                className={`cultivation-realm-item ${selected ? "is-active" : ""} ${realm.active ? "" : "is-disabled"}`}
                                style={{ "--cultivation-admin-accent": accent } as CSSProperties}
                                aria-current={selected ? "true" : undefined}
                                onClick={() => setSelectedRealmId(realm.id)}
                            >
                                <span className="cultivation-realm-tier" aria-hidden="true">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="cultivation-realm-visual-badge" aria-hidden="true">
                                    <img src={realmHero.badgeSrc} alt="" loading="lazy" decoding="async" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="cultivation-realm-name">{realm.name}</span>
                                    <span className="cultivation-realm-meta">
                                        <span>{realm.dailyLimit === null ? "不限额度" : `${realm.dailyLimit} 次/日`}</span>
                                        <span aria-hidden="true">·</span>
                                        <span>{activeStageCount} 阶段</span>
                                    </span>
                                </span>
                                <span className="cultivation-realm-aura" aria-hidden="true">
                                    <img src={realmHero.auraSrc} alt="" loading="lazy" decoding="async" />
                                </span>
                                <span className="cultivation-realm-state-wrap">
                                    <span className={`cultivation-realm-state ${realm.active ? "is-enabled" : ""}`} aria-hidden="true" />
                                    <span className="cultivation-realm-state-label">{realm.active ? "已启用" : "已停用"}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </aside>

            <section className="cultivation-rule-workspace">
                {selectedRealm ? (
                    <>
                        <div className="cultivation-rule-heading">
                            <RealmConfigIdentity realm={selectedRealm} />
                            <div className="flex items-center gap-2">
                                <Tooltip title="预览突破反馈">
                                    <Button icon={<Eye className="size-4" />} disabled={activeStages.length < 2} onClick={preview} aria-label={`预览 ${selectedRealm.name} 突破反馈`} />
                                </Tooltip>
                                <Button icon={<Edit3 className="size-4" />} onClick={() => setEditingRealm(selectedRealm)}>
                                    编辑境界
                                </Button>
                            </div>
                        </div>
                        <div className="cultivation-admin-metric-strip cultivation-rule-metrics">
                            <AdminMetric label="每日额度" value={selectedRealm.dailyLimit === null ? "不限" : `${selectedRealm.dailyLimit} 次`} />
                            <AdminMetric label="最大并发" value={selectedRealm.maxConcurrency.toLocaleString()} />
                            <AdminMetric label="阶段数量" value={selectedRealm.stages.length.toLocaleString()} />
                            <AdminMetric label="突破反馈" value={animationPresetLabel(selectedRealm.animationPreset)} />
                        </div>
                        <div className="cultivation-admin-section-heading">
                            <div>
                                <h2>阶段进度</h2>
                                <p>阶段按成长顺序排列，选择一行可调整升级阈值和开放能力。</p>
                            </div>
                        </div>
                        <StageRulesTable stages={selectedRealm.stages} onEdit={setEditingStage} />
                    </>
                ) : (
                    <Empty description="暂无境界配置" />
                )}
            </section>

            <RealmDrawer realm={editingRealm} onClose={() => setEditingRealm(null)} onSubmit={saveRealm} />
            <StageDrawer stage={editingStage} capabilities={data.capabilities} onClose={() => setEditingStage(null)} onSubmit={saveStage} />
        </div>
    );
}

function StageRulesTable({ stages, onEdit }: { stages: CultivationStageConfig[]; onEdit: (stage: CultivationStageConfig) => void }) {
    const columns: ColumnsType<CultivationStageConfig> = [
        {
            title: "阶段",
            dataIndex: "name",
            width: 220,
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
                    <Button
                        type="text"
                        shape="circle"
                        icon={<Edit3 className="size-4" />}
                        onClick={(event) => {
                            event.stopPropagation();
                            onEdit(stage);
                        }}
                        aria-label={`编辑 ${stage.name}`}
                    />
                </Tooltip>
            ),
        },
    ];
    return (
        <Table<CultivationStageConfig>
            className="cultivation-admin-table"
            rowKey="id"
            size="middle"
            pagination={false}
            scroll={{ x: 720 }}
            dataSource={stages}
            columns={columns}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该境界暂无阶段" /> }}
            onRow={(stage) => ({
                className: "cultivation-admin-clickable-row",
                tabIndex: 0,
                onClick: () => onEdit(stage),
                onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onEdit(stage);
                    }
                },
            })}
        />
    );
}

function CapabilitiesQuotaPanel() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });
    const [editingRealm, setEditingRealm] = useState<CultivationRealmConfig | null>(null);
    if (!data) return isLoading ? <div className="cultivation-admin-loading">正在加载能力与额度…</div> : <Empty description="配置暂不可用" />;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "cultivation", "config"] });
    const saveRealm = async (values: RealmFormValues) => {
        if (!editingRealm) return;
        try {
            await updateCultivationRealm(editingRealm.id, values);
            setEditingRealm(null);
            await refresh();
            message.success("境界额度已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    return (
        <div className="space-y-10">
            <section className="cultivation-admin-panel">
                <div className="cultivation-admin-section-heading">
                    <div>
                        <h2>境界默认额度</h2>
                        <p>用户没有单独覆盖时，将使用这里的每日额度和最大并发。</p>
                    </div>
                </div>
                <RealmQuotaTable realms={data.realms} onEdit={setEditingRealm} />
            </section>
            <RewardEditor configuration={data} onSaved={refresh} />
            <CapabilityEditor configuration={data} onSaved={refresh} />
            <RealmDrawer realm={editingRealm} onClose={() => setEditingRealm(null)} onSubmit={saveRealm} />
        </div>
    );
}

function RealmQuotaTable({ realms, onEdit }: { realms: CultivationRealmConfig[]; onEdit: (realm: CultivationRealmConfig) => void }) {
    return (
        <Table<CultivationRealmConfig>
            className="cultivation-admin-table"
            rowKey="id"
            size="middle"
            pagination={false}
            scroll={{ x: 760 }}
            dataSource={realms}
            columns={[
                { title: "境界", key: "realm", width: 240, render: (_: unknown, realm) => <RealmConfigIdentity realm={realm} showBadge /> },
                { title: "每日额度", key: "dailyLimit", width: 130, align: "right", render: (_: unknown, realm) => <span className="cultivation-count">{realm.dailyLimit === null ? "不限" : `${realm.dailyLimit} 次`}</span> },
                { title: "最大并发", dataIndex: "maxConcurrency", width: 110, align: "right", render: (value: number) => <span className="cultivation-count">{value}</span> },
                { title: "状态", dataIndex: "active", width: 96, render: (active: boolean) => (active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
                {
                    title: "",
                    key: "actions",
                    width: 56,
                    fixed: "right",
                    render: (_: unknown, realm) => (
                        <Tooltip title="编辑额度">
                            <Button type="text" shape="circle" icon={<Edit3 className="size-4" />} onClick={() => onEdit(realm)} aria-label={`编辑 ${realm.name} 额度`} />
                        </Tooltip>
                    ),
                },
            ]}
        />
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
                    <Form.Item label="升级所需修为" name="requiredXp" extra="达到此数值后由系统自动升级">
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
            <Table<CultivationConfiguration["capabilities"][number]>
                className="cultivation-admin-table"
                rowKey="key"
                size="middle"
                pagination={false}
                dataSource={configuration.capabilities}
                scroll={{ x: 680 }}
                columns={[
                    {
                        title: "能力",
                        key: "capability",
                        render: (_: unknown, capability) => (
                            <div className="min-w-0">
                                <div className="truncate font-medium text-stone-900 dark:text-stone-100">{capability.label}</div>
                                <div className="mt-1 truncate font-mono text-xs text-stone-500" title={capability.key}>
                                    {capability.key}
                                </div>
                            </div>
                        ),
                    },
                    { title: "分类", dataIndex: "category", key: "category", width: 140, render: (value: string) => <Tag>{capabilityCategoryLabel(value)}</Tag> },
                    { title: "当前状态", dataIndex: "active", key: "active", width: 130, render: (active: boolean) => (active ? <Tag color="green">已开放</Tag> : <Tag>已关闭</Tag>) },
                    {
                        title: "全局开关",
                        key: "switch",
                        width: 110,
                        align: "right",
                        render: (_: unknown, capability) => (
                            <Switch
                                checked={capability.active}
                                loading={mutation.isPending && mutation.variables?.key === capability.key}
                                disabled={mutation.isPending}
                                aria-label={`${capability.active ? "关闭" : "启用"} ${capability.label}`}
                                onChange={(checked) => update(capability.key, checked)}
                            />
                        ),
                    },
                ]}
            />
        </section>
    );
}

function OverviewPanel({ onOpenUser, onNavigate }: { onOpenUser: (displayName: string) => void; onNavigate: (section: AdminSectionKey) => void }) {
    const system = useQuery({ queryKey: ["admin", "metrics"], queryFn: fetchAdminMetrics, refetchInterval: 30_000 });
    const channels = useQuery({ queryKey: ["admin", "channels", "metrics", 7], queryFn: () => fetchAdminChannelMetrics(7), refetchInterval: 30_000 });
    const config = useQuery({ queryKey: ["admin", "cultivation", "config"], queryFn: fetchCultivationConfiguration });
    const users = useQuery({ queryKey: ["admin", "cultivation", "users", "overview"], queryFn: () => fetchAdminCultivationUsers(1, 5, "") });
    const audits = useQuery({ queryKey: ["admin", "cultivation", "audit-logs", 1, 6, "overview"], queryFn: () => fetchCultivationLog<LogRow>("audit-logs", 1, 6) });
    const jobs = system.data?.jobs;
    const activeJobs = Number(jobs?.queued || 0) + Number(jobs?.running || 0);
    const channelItems = channels.data?.items || [];
    const channelIssues = channelItems.filter((channel) => channel.status === "degraded" || channel.status === "unavailable");
    const realms = (config.data?.realms || []).filter((realm) => realm.active).sort((left, right) => left.sortOrder - right.sortOrder);
    const enabledCapabilities = (config.data?.capabilities || []).filter((capability) => capability.active).length;
    const failedJobs = Number(jobs?.failed || 0);

    return (
        <div className="cultivation-admin-dashboard">
            <section className="cultivation-admin-dashboard-hero">
                <div className="cultivation-admin-hero-copy">
                    <p className="cultivation-admin-eyebrow">
                        <Sparkles className="size-3.5" aria-hidden="true" /> CULTIVATION OPERATIONS
                    </p>
                    <h2>掌教殿 · 修炼管理中枢</h2>
                    <p>在这里掌控用户成长、能力开放与系统运行状态。所有调整都会留下可追溯的管理记录。</p>
                </div>
                <div className="cultivation-admin-hero-actions">
                    <Button type="primary" icon={<Users className="size-4" />} onClick={() => onNavigate("users")}>
                        管理用户
                    </Button>
                    <Button icon={<BookOpenCheck className="size-4" />} onClick={() => onNavigate("rules")}>
                        调整规则
                    </Button>
                </div>
                <div className="cultivation-admin-hero-meta">
                    <span>
                        <span className="cultivation-admin-status-dot" />
                        系统在线 · 每 30 秒自动刷新
                    </span>
                    <span>数据范围：当前服务实例</span>
                </div>
            </section>

            <section className="cultivation-admin-metric-strip cultivation-overview-metrics">
                <AdminMetric icon={<Users className="size-4" />} label="用户总数" value={formatMetricValue(system.data?.users)} delta="平台账户" />
                <AdminMetric icon={<ServerCog className="size-4" />} label="接入渠道" value={formatMetricValue(system.data?.channels)} delta="已配置" />
                <AdminMetric icon={<Activity className="size-4" />} label="运行中任务" value={formatMetricValue(activeJobs)} tone={activeJobs > 0 ? "active" : undefined} delta="队列 + 执行" />
                <AdminMetric icon={<CheckCircle2 className="size-4" />} label="累计完成" value={formatMetricValue(jobs?.succeeded)} delta="生成任务" />
                <AdminMetric icon={<CircleAlert className="size-4" />} label="累计失败" value={formatMetricValue(failedJobs)} tone={failedJobs ? "danger" : undefined} delta="需要关注" />
                <AdminMetric icon={<ShieldCheck className="size-4" />} label="开放能力" value={formatMetricValue(enabledCapabilities)} delta="全局开关" />
            </section>

            <section className="cultivation-admin-dashboard-grid cultivation-admin-dashboard-grid-main">
                <div className="cultivation-admin-panel cultivation-admin-realm-panel">
                    <div className="cultivation-admin-panel-header">
                        <div>
                            <p className="cultivation-admin-panel-kicker">REALM CONFIGURATION</p>
                            <h2>境界体系</h2>
                            <p>当前已启用的修炼层级与阶段规模。</p>
                        </div>
                        <Button type="text" icon={<ArrowUpRight className="size-4" />} onClick={() => onNavigate("rules")}>
                            查看详情
                        </Button>
                    </div>
                    <div className="cultivation-admin-realm-rail">
                        {realms.map((realm, index) => {
                            const realmHero = cultivationRealmHero(realm.id);
                            return (
                                <div key={realm.id} className="cultivation-admin-realm-node" style={{ "--realm-node-color": realm.color } as CSSProperties}>
                                    <div className="cultivation-admin-realm-node-badge" aria-hidden="true">
                                        <img src={realmHero.badgeSrc} alt="" loading="lazy" decoding="async" />
                                    </div>
                                    <div className="cultivation-admin-realm-node-copy">
                                        <span className="cultivation-admin-realm-node-order">{String(index + 1).padStart(2, "0")}</span>
                                        <strong>{realm.name}</strong>
                                        <span>{realm.stages.filter((stage) => stage.active).length} 个阶段</span>
                                    </div>
                                    <div className="cultivation-admin-realm-node-aura" aria-hidden="true">
                                        <img src={realmHero.auraSrc} alt="" loading="lazy" decoding="async" />
                                    </div>
                                </div>
                            );
                        })}
                        {!config.isLoading && !realms.length ? <AdminEmptyLine text="暂无已启用境界配置" /> : null}
                    </div>
                    <div className="cultivation-admin-panel-footnote">
                        <span>
                            <Database className="size-3.5" />
                            规则配置已持久化
                        </span>
                        <span>
                            {realms.length} 个境界 · {realms.reduce((total, realm) => total + realm.stages.length, 0)} 个阶段
                        </span>
                    </div>
                </div>

                <div className="cultivation-admin-panel cultivation-admin-quick-panel">
                    <div className="cultivation-admin-panel-header">
                        <div>
                            <p className="cultivation-admin-panel-kicker">QUICK ACCESS</p>
                            <h2>快捷管理</h2>
                            <p>常用配置入口。</p>
                        </div>
                    </div>
                    <div className="cultivation-admin-quick-grid">
                        <OverviewQuickLink icon={<Users className="size-4" />} title="用户管理" detail="境界、修为、额度" onClick={() => onNavigate("users")} />
                        <OverviewQuickLink icon={<BookOpenCheck className="size-4" />} title="成长规则" detail="阶段与突破反馈" onClick={() => onNavigate("rules")} />
                        <OverviewQuickLink icon={<ShieldCheck className="size-4" />} title="能力与额度" detail="开放能力与奖励" onClick={() => onNavigate("capabilities")} />
                        <OverviewQuickLink icon={<ServerCog className="size-4" />} title="运行监控" detail="渠道与服务状态" onClick={() => onNavigate("monitoring")} />
                    </div>
                </div>
            </section>

            <section className="cultivation-admin-dashboard-grid cultivation-admin-dashboard-grid-bottom">
                <div className="cultivation-admin-panel">
                    <div className="cultivation-admin-panel-header">
                        <div>
                            <p className="cultivation-admin-panel-kicker">SYSTEM PULSE</p>
                            <h2>今日系统数据</h2>
                            <p>服务实例的实时运行概览。</p>
                        </div>
                        <Button type="text" icon={<ArrowUpRight className="size-4" />} onClick={() => onNavigate("monitoring")}>
                            打开监控
                        </Button>
                    </div>
                    <div className="cultivation-admin-pulse-list">
                        <OverviewPulse icon={<TrendingUp className="size-4" />} label="任务处理" value={`${formatMetricValue(jobs?.succeeded)} 完成`} detail={`${formatMetricValue(activeJobs)} 条正在处理`} tone="good" />
                        <OverviewPulse icon={<ServerCog className="size-4" />} label="服务运行" value={formatUptime(system.data?.uptimeSeconds)} detail={system.data ? `内存 ${formatBytes(system.data.memory.rss)}` : "等待数据"} />
                        <OverviewPulse
                            icon={<CircleAlert className="size-4" />}
                            label="异常渠道"
                            value={formatMetricValue(channelIssues.length)}
                            detail={channelIssues.length ? "请前往运行监控处理" : "当前没有异常渠道"}
                            tone={channelIssues.length ? "warning" : "good"}
                        />
                    </div>
                </div>

                <div className="cultivation-admin-panel">
                    <div className="cultivation-admin-panel-header">
                        <div>
                            <p className="cultivation-admin-panel-kicker">RECENT ACTIVITY</p>
                            <h2>最近管理动态</h2>
                            <p>规则和用户变更记录。</p>
                        </div>
                        <Button type="text" icon={<ArrowUpRight className="size-4" />} onClick={() => onNavigate("records")}>
                            全部记录
                        </Button>
                    </div>
                    <div className="cultivation-audit-list">
                        {(audits.data?.items || []).map((row) => {
                            const targetName = String(row.target_name || "").trim();
                            return (
                                <div key={String(row.id || JSON.stringify(row))}>
                                    <div className="cultivation-audit-icon">
                                        <Settings2 className="size-4" aria-hidden="true" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{auditActionLabel(String(row.action || ""))}</div>
                                        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-stone-500">
                                            {targetName ? (
                                                <button type="button" className="cultivation-log-user" onClick={() => onOpenUser(targetName)}>
                                                    {targetName}
                                                </button>
                                            ) : (
                                                <span>系统规则</span>
                                            )}
                                            <span>·</span>
                                            <span className="truncate">{formatTimestamp(row.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {!audits.isLoading && !audits.data?.items.length ? <AdminEmptyLine text="暂无管理操作记录" /> : null}
                    </div>
                </div>
            </section>

            <section className="cultivation-admin-panel cultivation-admin-recent-users">
                <div className="cultivation-admin-panel-header">
                    <div>
                        <p className="cultivation-admin-panel-kicker">ACTIVE CULTIVATORS</p>
                        <h2>修炼者概览</h2>
                        <p>快速查看最近用户的境界与成长进度。</p>
                    </div>
                    <Button type="text" icon={<ArrowUpRight className="size-4" />} onClick={() => onNavigate("users")}>
                        查看全部用户
                    </Button>
                </div>
                <div className="cultivation-admin-user-strip">
                    {(users.data?.items || []).map((user) => (
                        <div key={user.userId} className="cultivation-admin-user-card">
                            <UserIdentity user={user} />
                            <RealmBadge user={user} />
                        </div>
                    ))}
                    {!users.isLoading && !users.data?.items.length ? <AdminEmptyLine text="暂无用户数据" /> : null}
                </div>
            </section>
        </div>
    );
}

function OverviewQuickLink({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
    return (
        <button type="button" className="cultivation-admin-quick-link" onClick={onClick}>
            <span className="cultivation-admin-quick-icon">{icon}</span>
            <span className="min-w-0">
                <strong>{title}</strong>
                <small>{detail}</small>
            </span>
            <ChevronRight className="ml-auto size-4" aria-hidden="true" />
        </button>
    );
}

function OverviewPulse({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone?: "good" | "warning" }) {
    return (
        <div className={`cultivation-admin-pulse-row ${tone ? `is-${tone}` : ""}`}>
            <span className="cultivation-admin-pulse-icon">{icon}</span>
            <div className="min-w-0 flex-1">
                <span>{label}</span>
                <strong>{value}</strong>
            </div>
            <small>{detail}</small>
        </div>
    );
}

function MonitoringPanel() {
    const channels = useQuery({
        queryKey: ["admin", "channels", "metrics", 7],
        queryFn: () => fetchAdminChannelMetrics(7),
        refetchInterval: 30_000,
    });
    const system = useQuery({
        queryKey: ["admin", "metrics"],
        queryFn: fetchAdminMetrics,
        refetchInterval: 30_000,
    });
    const backup = system.data?.backup;
    const jobs = system.data?.jobs;
    const activeJobs = Number(jobs?.queued || 0) + Number(jobs?.running || 0);
    const channelItems = channels.data?.items || [];
    const abnormalChannels = channelItems.filter((channel) => channel.status === "degraded" || channel.status === "unavailable").length;

    return (
        <div className="space-y-10">
            <section className="cultivation-admin-panel">
                <div className="cultivation-admin-metric-strip">
                    <AdminMetric label="运行中任务" value={formatMetricValue(activeJobs)} tone={activeJobs ? "active" : undefined} />
                    <AdminMetric label="正常渠道" value={formatMetricValue(channelItems.length - abnormalChannels)} />
                    <AdminMetric label="异常渠道" value={formatMetricValue(abnormalChannels)} tone={abnormalChannels ? "warning" : undefined} />
                    <AdminMetric label="服务运行时间" value={formatUptime(system.data?.uptimeSeconds)} />
                    <AdminMetric label="内存占用" value={system.data ? formatBytes(system.data.memory.rss) : "—"} />
                </div>
            </section>
            <section className="cultivation-admin-panel">
                <div className="cultivation-admin-panel-header">
                    <div>
                        <h2>渠道状态</h2>
                        <p>最近 7 天的成功率、平均耗时、运行任务和错误摘要。</p>
                    </div>
                    <Tooltip title="刷新渠道与备份状态">
                        <Button type="text" icon={<RefreshCw className={`size-4 ${channels.isFetching || system.isFetching ? "animate-spin" : ""}`} />} aria-label="刷新渠道状态" onClick={() => void Promise.all([channels.refetch(), system.refetch()])} />
                    </Tooltip>
                </div>
                <Table<AdminChannelMetric>
                    className="cultivation-admin-table"
                    rowKey={(row) => `${row.userId}:${row.channelId}`}
                    size="middle"
                    loading={channels.isLoading}
                    dataSource={channels.data?.items || []}
                    scroll={{ x: 1040 }}
                    pagination={false}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={channels.isError ? "渠道状态加载失败" : "暂无渠道"} /> }}
                    columns={[
                        {
                            title: "渠道",
                            key: "channel",
                            width: 190,
                            render: (_, row) => (
                                <div className="min-w-0">
                                    <div className="truncate font-medium" title={row.channelName}>
                                        {row.channelName}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-stone-500" title={row.host}>
                                        {row.host}
                                    </div>
                                </div>
                            ),
                        },
                        { title: "用户", dataIndex: "ownerName", key: "ownerName", width: 130, ellipsis: true },
                        { title: "状态", dataIndex: "status", key: "status", width: 105, render: (value) => <ChannelStatusTag status={value} /> },
                        {
                            title: "成功率",
                            dataIndex: "successRate",
                            key: "successRate",
                            width: 95,
                            align: "right",
                            render: (value) => (value === null ? "-" : `${value}%`),
                        },
                        {
                            title: "图片",
                            key: "images",
                            width: 120,
                            align: "right",
                            render: (_, row) => (
                                <span className="cultivation-count">
                                    {row.successImages} 成功 / {row.failedImages} 失败
                                </span>
                            ),
                        },
                        { title: "平均耗时", dataIndex: "avgDurationMs", key: "avgDurationMs", width: 110, align: "right", render: (value) => (value ? formatDuration(value) : "-") },
                        { title: "P95 耗时", dataIndex: "p95DurationMs", key: "p95DurationMs", width: 110, align: "right", render: (value) => (value ? formatDuration(value) : "-") },
                        { title: "运行中", dataIndex: "activeJobs", key: "activeJobs", width: 85, align: "right" },
                        { title: "最近使用", dataIndex: "lastUsedAt", key: "lastUsedAt", width: 170, render: (value) => (value ? formatTimestamp(value) : "尚未使用") },
                        {
                            title: "最近错误",
                            dataIndex: "lastError",
                            key: "lastError",
                            ellipsis: true,
                            render: (value) =>
                                value ? (
                                    <span className="text-red-600 dark:text-red-300" title={friendlyErrorMessage(value)}>
                                        {friendlyErrorMessage(value)}
                                    </span>
                                ) : (
                                    "-"
                                ),
                        },
                    ]}
                />
            </section>

            <section className="cultivation-admin-panel">
                <div className="cultivation-admin-section-heading">
                    <div>
                        <h2>系统维护</h2>
                        <p>查看数据备份和无主资源清理状态。</p>
                    </div>
                </div>
                <div className="cultivation-maintenance-list">
                    <MaintenanceRow icon={<ShieldCheck className="size-4" />} title="自动备份" status={system.isError || backup?.lastError ? "error" : backup?.enabled ? "healthy" : "disabled"} detail={backupSummary(system.data?.backup, system.isError)} />
                    <MaintenanceRow
                        icon={<CircleGauge className="size-4" />}
                        title="资源清理"
                        status={system.data?.assetGc.lastError ? "error" : system.data?.assetGc.enabled ? "healthy" : "disabled"}
                        detail={assetGcSummary(system.data?.assetGc, system.isError)}
                    />
                </div>
            </section>
        </div>
    );
}

function RecordsPanel({ kind, userId, onKindChange, onUserChange, onOpenUser }: { kind: LogKind; userId: string; onKindChange: (kind: LogKind) => void; onUserChange: (userId: string | null) => void; onOpenUser: (displayName: string) => void }) {
    const users = useQuery({ queryKey: ["admin", "cultivation", "users", "record-filter"], queryFn: () => fetchAdminCultivationUsers(1, 100, "") });
    const details = recordViewDetails[kind];
    return (
        <section className="cultivation-admin-panel cultivation-records-panel">
            <div className="cultivation-records-toolbar">
                <div className="cultivation-records-segmented">
                    <Segmented value={kind} options={Object.entries(recordViewDetails).map(([value, item]) => ({ value, label: item.label }))} onChange={(value) => onKindChange(value as LogKind)} />
                </div>
                <Select
                    allowClear
                    showSearch
                    value={userId || undefined}
                    className="w-52 max-w-full"
                    placeholder="筛选用户…"
                    aria-label="筛选记录用户"
                    optionFilterProp="label"
                    options={(users.data?.items || []).map((user) => ({ value: user.userId, label: user.displayName }))}
                    onChange={(value) => onUserChange(value || null)}
                />
            </div>
            <div className="cultivation-admin-section-heading cultivation-records-heading">
                <div>
                    <h2>{details.title}</h2>
                    <p>{details.description}</p>
                </div>
            </div>
            <LogPanel kind={kind} userId={userId} onOpenUser={onOpenUser} />
        </section>
    );
}

const recordViewDetails: Record<LogKind, { label: string; title: string; description: string }> = {
    usage: { label: "生成用量", title: "生成用量", description: "按任务记录请求、成功结算、失败退还和耗时。" },
    ledger: { label: "修为流水", title: "修为流水", description: "记录生成奖励、管理员增减与每次结算后的总修为。" },
    "audit-logs": { label: "管理操作", title: "管理操作", description: "记录用户、境界、阶段、能力和奖励规则的修改。" },
    "login-logs": { label: "登录安全", title: "登录安全", description: "保留必要的登录结果、设备信息与脱敏 IP。" },
    breakthroughs: { label: "突破记录", title: "突破记录", description: "查看自动突破和历史人工处理记录。" },
};

function LogPanel({ kind, userId, onOpenUser }: { kind: LogKind; userId: string; onOpenUser: (displayName: string) => void }) {
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<LogRow | null>(null);
    useEffect(() => {
        setPage(1);
        setSelected(null);
    }, [kind, userId]);
    const { data, isFetching } = useQuery({ queryKey: ["admin", "cultivation", kind, page, userId], queryFn: () => fetchCultivationLog<LogRow>(kind, page, 20, userId) });
    return (
        <>
            <Table<LogRow>
                className="cultivation-admin-table cultivation-admin-log-table"
                rowKey={(row) => String(row.id || row.job_id || JSON.stringify(row))}
                size="middle"
                loading={isFetching}
                dataSource={data?.items || []}
                scroll={{ x: 900 }}
                pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage, showSizeChanger: false, showTotal: (total) => `共 ${total} 条记录` }}
                columns={getLogColumns(kind, onOpenUser)}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" /> }}
                onRow={(row) => ({
                    className: "cultivation-admin-clickable-row",
                    tabIndex: 0,
                    onClick: () => setSelected(row),
                    onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelected(row);
                        }
                    },
                })}
            />
            <RecordDetailDrawer kind={kind} record={selected} onClose={() => setSelected(null)} />
        </>
    );
}

function RecordDetailDrawer({ kind, record, onClose }: { kind: LogKind; record: LogRow | null; onClose: () => void }) {
    const items = Object.entries(record || {}).map(([key, value]) => ({
        key,
        label: recordFieldLabel(key),
        children: <span className="break-words">{formatLogValue(value, key)}</span>,
    }));
    return (
        <Drawer title={`${recordViewDetails[kind].title}详情`} open={Boolean(record)} width={520} rootClassName="cultivation-admin-drawer" onClose={onClose} destroyOnHidden>
            <Descriptions className="cultivation-record-details" column={1} size="small" items={items} />
        </Drawer>
    );
}

function CultivationProgress({ user }: { user: Pick<AdminCultivationUser, "currentXp" | "requiredXp" | "nextStageName"> }) {
    const completed = !user.nextStageName || user.requiredXp <= 0;
    const percent = completed ? 100 : Math.max(0, Math.min(100, (user.currentXp / user.requiredXp) * 100));
    return (
        <div className="cultivation-progress-cell">
            <div className="flex items-center justify-between gap-3">
                <span className="cultivation-count">{completed ? "已达顶峰" : `${user.currentXp.toLocaleString()} / ${user.requiredXp.toLocaleString()}`}</span>
                {!completed ? <span className="text-xs text-stone-500">{Math.round(percent)}%</span> : null}
            </div>
            <div className="cultivation-progress-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${percent / 100})` }} />
            </div>
        </div>
    );
}

function AdminMetric({ label, value, tone, icon, delta }: { label: string; value: string; tone?: "active" | "warning" | "danger"; icon?: ReactNode; delta?: string }) {
    return (
        <div className={`cultivation-admin-metric ${tone ? `is-${tone}` : ""}`}>
            <div className="cultivation-admin-metric-label">
                {icon ? <span className="cultivation-admin-metric-icon">{icon}</span> : null}
                <span>{label}</span>
            </div>
            <strong>{value}</strong>
            {delta ? <small>{delta}</small> : null}
        </div>
    );
}

function FormSectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <div className="cultivation-form-section-heading">
            <h3>{title}</h3>
            <p>{description}</p>
        </div>
    );
}

function AdminEmptyLine({ text }: { text: string }) {
    return (
        <div className="cultivation-admin-empty-line">
            <ShieldCheck className="size-4" aria-hidden="true" />
            <span>{text}</span>
        </div>
    );
}

function MaintenanceRow({ icon, title, status, detail }: { icon: ReactNode; title: string; status: "healthy" | "disabled" | "error"; detail: string }) {
    const labels = {
        healthy: { text: "正常", color: "green" },
        disabled: { text: "未启用", color: undefined },
        error: { text: "需处理", color: "red" },
    } as const;
    const label = labels[status];
    return (
        <div>
            <div className="cultivation-maintenance-icon">{icon}</div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="font-medium">{title}</span>
                    <Tag color={label.color}>{label.text}</Tag>
                </div>
                <p>{detail}</p>
            </div>
        </div>
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
        user("操作人", "approved_name", "approved_by", 130),
        text("原因", "reason"),
        text("时间", "created_at", 170),
    ];
}

function UserIdentity({ user, large = false }: { user: Pick<AdminCultivationUser, "displayName" | "userId" | "avatarUrl">; large?: boolean }) {
    const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "U";
    return (
        <div className={`cultivation-user-identity ${large ? "is-large" : ""}`}>
            <ProfileAvatarImage src={user.avatarUrl} alt="" fallback={initial} width={large ? 40 : 32} height={large ? 40 : 32} loading={large ? "eager" : "lazy"} fetchPriority={large ? "high" : "low"} className="cultivation-user-avatar" />
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

function RealmConfigIdentity({ realm, showBadge = false }: { realm: CultivationRealmConfig; showBadge?: boolean }) {
    const accent = cultivationAccentColor(realm.color);
    const realmHero = cultivationRealmHero(realm.id);
    return (
        <div className="flex min-w-0 items-center gap-2.5" style={{ "--cultivation-admin-accent": accent } as CSSProperties}>
            {showBadge ? (
                <span className="cultivation-quota-realm-badge" aria-hidden="true">
                    <img src={realmHero.badgeSrc} alt="" loading="lazy" decoding="async" />
                </span>
            ) : (
                <span className="cultivation-realm-symbol">
                    <RealmIcon iconKey={realm.iconKey} className="size-4" />
                </span>
            )}
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

function ChannelStatusTag({ status }: { status: AdminChannelMetric["status"] }) {
    const labels: Record<AdminChannelMetric["status"], { label: string; color?: string }> = {
        idle: { label: "未使用" },
        active: { label: "运行中", color: "processing" },
        healthy: { label: "正常", color: "green" },
        degraded: { label: "需关注", color: "orange" },
        unavailable: { label: "异常", color: "red" },
    };
    const item = labels[status];
    return <Tag color={item.color}>{item.label}</Tag>;
}

function BreakthroughStatusTag({ status }: { status: string }) {
    const labels: Record<string, { label: string; color?: string }> = {
        pending: { label: "历史待处理", color: "gold" },
        approved: { label: "历史人工突破", color: "green" },
        automatic: { label: "自动突破", color: "blue" },
        superseded: { label: "已自动化解" },
    };
    const item = labels[status] || { label: status || "未知" };
    return <Tag color={item.color}>{item.label}</Tag>;
}

function LogUser({ value, id, onOpenUser }: { value: unknown; id: unknown; onOpenUser: (displayName: string) => void }) {
    const name = String(value || "").trim();
    if (name)
        return (
            <button
                type="button"
                className="cultivation-log-user"
                onClick={(event) => {
                    event.stopPropagation();
                    onOpenUser(name);
                }}
            >
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

function formatTimestamp(value: unknown) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
    return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function formatMetricValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
}

function formatUptime(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    if (days) return `${days} 天 ${hours} 小时`;
    const minutes = Math.floor(seconds / 60);
    return hours ? `${hours} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}

function animationPresetLabel(value: string) {
    return animationOptions.find((option) => option.value === value)?.label || value || "未设置";
}

function backupSummary(backup: AdminMetrics["backup"] | undefined, loadingError: boolean) {
    if (loadingError) return "备份状态读取失败，请刷新后重试。";
    if (!backup?.enabled) return "自动备份当前未启用。";
    if (backup.lastError) return `最近备份失败：${backup.lastError}`;
    if (!backup.lastCompletedAt) return "自动备份已启用，正在等待首次一致性快照。";
    return `最近完成于 ${formatTimestamp(backup.lastCompletedAt)}${backup.lastBytes ? `，大小 ${formatBytes(backup.lastBytes)}` : ""}，保留 ${backup.retentionCount} 份。`;
}

function assetGcSummary(assetGc: AdminMetrics["assetGc"] | undefined, loadingError: boolean) {
    if (loadingError) return "资源清理状态读取失败，请刷新后重试。";
    if (!assetGc?.enabled) return "无主资源自动清理当前未启用。";
    if (assetGc.lastError) return `最近清理失败：${assetGc.lastError}`;
    if (assetGc.running) return "正在清理无主资源。";
    if (!assetGc.lastCompletedAt) return "自动清理已启用，正在等待首次执行。";
    return `最近完成于 ${formatTimestamp(assetGc.lastCompletedAt)}，移除 ${assetGc.lastRemovedAssets} 条资源记录和 ${assetGc.lastRemovedFiles} 个文件。`;
}

function recordFieldLabel(key: string) {
    return (
        (
            {
                id: "记录编号",
                user_id: "用户 ID",
                display_name: "用户",
                admin_user_id: "管理员 ID",
                admin_name: "管理员",
                target_user_id: "目标用户 ID",
                target_name: "目标用户",
                action: "操作",
                reason: "原因",
                amount: "修为变化",
                balance_after: "累计修为",
                source_type: "来源",
                model: "模型",
                requested_count: "请求数量",
                success_count: "成功数量",
                status: "状态",
                duration_ms: "耗时",
                job_id: "任务编号",
                result: "登录结果",
                ip_display: "IP",
                user_agent: "设备",
                from_stage: "当前阶段",
                to_stage: "目标阶段",
                approved_name: "操作人",
                approved_by: "操作人 ID",
                created_at: "创建时间",
            } as Record<string, string>
        )[key] || key
    );
}

function sourceTypeLabel(value: string) {
    return ({ generation: "图片生成", admin: "管理员调整" } as Record<string, string>)[value] || value || "-";
}

function auditActionLabel(value: string) {
    return (
        (
            {
                "cultivation.user.update": "更新用户修炼信息",
                "cultivation.breakthrough.approve": "历史人工突破",
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

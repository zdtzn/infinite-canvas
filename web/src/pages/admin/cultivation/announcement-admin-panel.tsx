import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Empty, Form, Input, Select, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Archive, Bell, Edit3, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { createAdminAnnouncement, fetchAdminAnnouncements, updateAdminAnnouncement, type AnnouncementInput, type AnnouncementStatus, type AnnouncementType, type SystemAnnouncement } from "@/services/server-api";

type AnnouncementFormValues = AnnouncementInput;

const typeOptions: Array<{ value: AnnouncementType; label: string }> = [
    { value: "update", label: "功能更新" },
    { value: "notice", label: "平台通知" },
    { value: "maintenance", label: "维护提醒" },
];

const statusOptions: Array<{ value: AnnouncementStatus; label: string }> = [
    { value: "draft", label: "草稿" },
    { value: "published", label: "已发布" },
    { value: "archived", label: "已归档" },
];

export function AnnouncementAdminPanel() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<AnnouncementFormValues>();
    const selectedStatus = Form.useWatch("status", form);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [searchDraft, setSearchDraft] = useState("");
    const [type, setType] = useState<AnnouncementType | "">("");
    const [status, setStatus] = useState<AnnouncementStatus | "">("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editing, setEditing] = useState<SystemAnnouncement | null>(null);
    const query = useQuery({
        queryKey: ["admin", "announcements", page, search, type, status],
        queryFn: () => fetchAdminAnnouncements({ page, pageSize: 20, search, type, status }),
    });
    const saveMutation = useMutation({
        mutationFn: ({ id, values }: { id?: string; values: AnnouncementFormValues }) => (id ? updateAdminAnnouncement(id, values) : createAdminAnnouncement(values)),
        onSuccess: ({ item }) => {
            setDrawerOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
            void queryClient.invalidateQueries({ queryKey: ["announcements"] });
            message.success(item.status === "published" ? "公告已发布" : item.status === "archived" ? "公告已归档" : "公告草稿已保存");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "公告保存失败"),
    });
    const archiveMutation = useMutation({
        mutationFn: (id: string) => updateAdminAnnouncement(id, { status: "archived" }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
            void queryClient.invalidateQueries({ queryKey: ["announcements"] });
            message.success("公告已归档");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "公告归档失败"),
    });

    useEffect(() => setPage(1), [search, type, status]);

    const formStatusOptions = editing?.status === "archived" ? statusOptions.map((option) => (option.value === "archived" ? { ...option, disabled: true } : option)) : statusOptions.filter((option) => option.value !== "archived");
    const submitLabel = selectedStatus === "published" ? (editing?.status === "published" ? "保存修改" : "发布公告") : "保存公告";

    const openCreate = () => {
        form.resetFields();
        setEditing(null);
        form.setFieldsValue({ title: "", summary: "", content: "", type: "notice", status: "draft", pinned: false });
        setDrawerOpen(true);
    };

    const openEdit = (item: SystemAnnouncement) => {
        form.resetFields();
        setEditing(item);
        form.setFieldsValue({
            title: item.title,
            summary: item.summary,
            content: item.content,
            type: item.type,
            status: item.status,
            pinned: item.pinned,
        });
        setDrawerOpen(true);
    };

    const closeDrawer = () => {
        if (saveMutation.isPending) return;
        if (!form.isFieldsTouched()) {
            setDrawerOpen(false);
            return;
        }
        modal.confirm({
            title: "放弃未保存的公告？",
            content: "关闭后，本次修改不会保存。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            onOk: () => {
                setDrawerOpen(false);
                form.resetFields();
            },
        });
    };

    const submit = async () => {
        const values = await form.validateFields();
        const save = () => saveMutation.mutateAsync({ id: editing?.id, values });
        if (values.status === "published" && editing?.status !== "published") {
            modal.confirm({
                title: editing ? "发布这条公告？" : "立即发布公告？",
                content: "发布后所有用户都能看到，顶部公告入口也会显示未读提醒。",
                okText: "确认发布",
                cancelText: "继续编辑",
                onOk: save,
            });
            return;
        }
        await save();
    };

    const columns: ColumnsType<SystemAnnouncement> = [
        {
            title: "公告",
            key: "announcement",
            width: 330,
            render: (_value, item) => (
                <div className="announcement-admin-title-cell">
                    <div>
                        <strong>{item.title}</strong>
                        {item.pinned ? <Tag color="gold">置顶</Tag> : null}
                    </div>
                    <span>{item.summary || item.content.slice(0, 90)}</span>
                </div>
            ),
        },
        { title: "类型", dataIndex: "type", key: "type", width: 110, render: (value: AnnouncementType) => <AnnouncementTypeTag type={value} /> },
        { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value: AnnouncementStatus) => <AnnouncementStatusTag status={value} /> },
        { title: "发布人", dataIndex: "authorName", key: "authorName", width: 120, ellipsis: true },
        { title: "发布时间", dataIndex: "publishedAt", key: "publishedAt", width: 170, render: (value: number | null, item) => formatTimestamp(value || item.updatedAt) },
        {
            title: "操作",
            key: "actions",
            width: 112,
            fixed: "right",
            render: (_value, item) => (
                <div className="announcement-admin-actions">
                    <Tooltip title="编辑公告">
                        <Button type="text" shape="circle" icon={<Edit3 className="size-4" />} aria-label={`编辑 ${item.title}`} onClick={() => openEdit(item)} />
                    </Tooltip>
                    {item.status !== "archived" ? (
                        <Tooltip title="归档公告">
                            <Button
                                type="text"
                                shape="circle"
                                danger
                                icon={<Archive className="size-4" />}
                                aria-label={`归档 ${item.title}`}
                                onClick={() =>
                                    modal.confirm({
                                        title: "归档这条公告？",
                                        content: "归档后用户端不再展示，但管理记录会保留。",
                                        okText: "确认归档",
                                        cancelText: "取消",
                                        onOk: () => archiveMutation.mutateAsync(item.id),
                                    })
                                }
                            />
                        </Tooltip>
                    ) : null}
                </div>
            ),
        },
    ];

    return (
        <section className="cultivation-admin-panel announcement-admin-panel">
            <div className="cultivation-admin-panel-header">
                <div>
                    <p className="cultivation-admin-panel-kicker">SYSTEM ANNOUNCEMENTS</p>
                    <h2>公告管理</h2>
                    <p>编辑、置顶并发布面向全体用户的平台通知。</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新建公告
                </Button>
            </div>

            <div className="announcement-admin-toolbar">
                <Input.Search
                    allowClear
                    value={searchDraft}
                    placeholder="搜索标题或正文…"
                    onChange={(event) => {
                        setSearchDraft(event.target.value);
                        if (!event.target.value) setSearch("");
                    }}
                    onSearch={(value) => setSearch(value.trim())}
                />
                <Select allowClear value={type || undefined} placeholder="全部类型" options={typeOptions} onChange={(value) => setType(value || "")} />
                <Select allowClear value={status || undefined} placeholder="全部状态" options={statusOptions} onChange={(value) => setStatus(value || "")} />
                <Tooltip title="刷新公告列表">
                    <Button type="text" shape="circle" icon={<RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />} aria-label="刷新公告列表" onClick={() => query.refetch()} />
                </Tooltip>
            </div>

            <Table<SystemAnnouncement>
                className="cultivation-admin-table"
                rowKey="id"
                loading={query.isFetching}
                dataSource={query.data?.items || []}
                columns={columns}
                scroll={{ x: 960 }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配公告" /> }}
                pagination={{ current: page, pageSize: 20, total: query.data?.total || 0, showSizeChanger: false, onChange: setPage, showTotal: (total) => `共 ${total} 条公告` }}
                onRow={(item) => ({ onDoubleClick: () => openEdit(item) })}
            />

            <Drawer
                title={editing ? "编辑公告" : "新建公告"}
                width={580}
                open={drawerOpen}
                destroyOnHidden
                onClose={closeDrawer}
                footer={
                    <div className="announcement-admin-drawer-footer">
                        <span>{editing?.status === "published" ? "修改正文后会重新标记为未读" : "可以先保存草稿，再确认发布"}</span>
                        <div>
                            <Button onClick={closeDrawer}>取消</Button>
                            <Button type="primary" loading={saveMutation.isPending} onClick={() => void submit()}>
                                {submitLabel}
                            </Button>
                        </div>
                    </div>
                }
            >
                <Form form={form} layout="vertical" initialValues={{ type: "notice", status: "draft", pinned: false }}>
                    <div className="announcement-admin-form-grid">
                        <Form.Item name="type" label="公告类型" rules={[{ required: true, message: "请选择公告类型" }]}>
                            <Select options={typeOptions} />
                        </Form.Item>
                        <Form.Item name="status" label="公告状态" rules={[{ required: true, message: "请选择公告状态" }]}>
                            <Select options={formStatusOptions} />
                        </Form.Item>
                    </div>
                    <Form.Item
                        name="title"
                        label="公告标题"
                        rules={[
                            { required: true, message: "请输入公告标题" },
                            { min: 2, message: "标题至少 2 个字符" },
                        ]}
                    >
                        <Input maxLength={120} showCount placeholder="例如：无限画布 2.4 功能更新" />
                    </Form.Item>
                    <Form.Item name="summary" label="简短摘要" extra="用于折叠状态下快速说明重点。">
                        <Input maxLength={240} showCount placeholder="用一句话说明这次公告的核心内容" />
                    </Form.Item>
                    <Form.Item
                        name="content"
                        label="公告正文"
                        rules={[
                            { required: true, message: "请输入公告正文" },
                            { min: 2, message: "正文至少 2 个字符" },
                        ]}
                        extra="支持自然分段，V1 不解析 HTML 或 Markdown。"
                    >
                        <Input.TextArea rows={12} maxLength={8000} showCount placeholder="填写公告正文…" />
                    </Form.Item>
                    <Form.Item name="pinned" label="置顶公告" valuePropName="checked" extra="置顶公告会优先出现在系统公告顶部。">
                        <Switch />
                    </Form.Item>
                </Form>
            </Drawer>
        </section>
    );
}

function AnnouncementTypeTag({ type }: { type: AnnouncementType }) {
    const item = typeOptions.find((option) => option.value === type);
    return <Tag color={type === "maintenance" ? "volcano" : type === "update" ? "gold" : undefined}>{item?.label || type}</Tag>;
}

function AnnouncementStatusTag({ status }: { status: AnnouncementStatus }) {
    const detail = {
        draft: { label: "草稿", color: "default" },
        published: { label: "已发布", color: "green" },
        archived: { label: "已归档", color: "default" },
    } as const;
    const item = detail[status];
    return <Tag color={item.color}>{item.label}</Tag>;
}

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

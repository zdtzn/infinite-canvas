import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Modal, Pagination, Result, Segmented, Skeleton } from "antd";
import { Bell, CheckCheck, Megaphone, Pin, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchAnnouncements, markAllAnnouncementsRead, markAnnouncementRead, type AnnouncementType, type SystemAnnouncement } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import "./announcements.css";

type AnnouncementView = "timeline" | "unread";

const typeDetails: Record<AnnouncementType, { label: string; icon: typeof Megaphone; className: string }> = {
    update: { label: "功能更新", icon: Sparkles, className: "is-update" },
    notice: { label: "平台通知", icon: Megaphone, className: "is-notice" },
    maintenance: { label: "维护提醒", icon: Wrench, className: "is-maintenance" },
};

type AnnouncementCenterDialogProps = {
    open: boolean;
    onClose: () => void;
    onAfterClose?: () => void;
};

export function AnnouncementCenterDialog({ open, onClose, onAfterClose }: AnnouncementCenterDialogProps) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const [view, setView] = useState<AnnouncementView>("timeline");
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ["announcements", "list", userId, view, page],
        queryFn: () => fetchAnnouncements({ page, pageSize: 10, unreadOnly: view === "unread" }),
        enabled: Boolean(userId) && open,
        staleTime: 20_000,
    });
    const readMutation = useMutation({
        mutationFn: (id: string) => markAnnouncementRead(id, userId),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        onError: (error) => message.error(userFacingErrorMessage(error, "暂时未能标记已读，请稍后再试")),
    });
    const readAllMutation = useMutation({
        mutationFn: markAllAnnouncementsRead,
        onSuccess: ({ count }) => {
            void queryClient.invalidateQueries({ queryKey: ["announcements"] });
            message.success(count ? `已将 ${count} 条公告标为已读` : "当前没有未读公告");
        },
        onError: (error) => message.error(userFacingErrorMessage(error, "暂时未能标记已读，请稍后再试")),
    });

    useEffect(() => {
        setPage(1);
    }, [view]);

    const items = query.data?.items || [];
    const pinnedItems = useMemo(() => items.filter((item) => item.pinned), [items]);
    const timelineItems = useMemo(() => items.filter((item) => !item.pinned), [items]);

    return (
        <Modal className="announcement-center-modal" title={null} open={open} centered width={1040} footer={null} destroyOnHidden afterClose={onAfterClose} onCancel={onClose}>
            <section className="announcements-dialog" aria-label="系统公告">
                <header className="announcements-header">
                    <div>
                        <p className="announcements-eyebrow">SYSTEM NOTICE</p>
                        <h2>系统公告</h2>
                        <p>查看平台更新、维护安排与重要通知。</p>
                    </div>
                    <div className="announcements-header-status" aria-live="polite">
                        <span className={query.data?.unreadCount ? "is-unread" : ""}>
                            <Bell className="size-4" aria-hidden="true" />
                            {query.data?.unreadCount ? `${query.data.unreadCount} 条未读` : "已全部阅览"}
                        </span>
                        {query.data?.unreadCount ? (
                            <Button icon={<CheckCheck className="size-4" />} loading={readAllMutation.isPending} onClick={() => readAllMutation.mutate()}>
                                全部标为已读
                            </Button>
                        ) : null}
                    </div>
                </header>

                <div className="announcements-toolbar">
                    <Segmented
                        block
                        value={view}
                        options={[
                            {
                                value: "timeline",
                                label: (
                                    <span className="announcements-tab-label">
                                        <Megaphone className="size-4" />
                                        时间线
                                    </span>
                                ),
                            },
                            {
                                value: "unread",
                                label: (
                                    <span className="announcements-tab-label">
                                        <Bell className="size-4" />
                                        未读通知{query.data?.unreadCount ? <b>{query.data.unreadCount}</b> : null}
                                    </span>
                                ),
                            },
                        ]}
                        onChange={(value) => setView(value as AnnouncementView)}
                    />
                    <Button type="text" shape="circle" aria-label="刷新系统公告" title="刷新" icon={<RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />} onClick={() => query.refetch()} />
                </div>

                <div className="announcements-scroll">
                    {query.isLoading ? <AnnouncementSkeleton /> : null}
                    {query.isError ? <Result status="warning" title="公告暂时无法加载" subTitle={userFacingErrorMessage(query.error, "请稍后重新加载")} extra={<Button onClick={() => query.refetch()}>重新加载</Button>} /> : null}
                    {!query.isLoading && !query.isError && !items.length ? (
                        <div className="announcements-empty">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={view === "unread" ? "没有未读公告" : "暂时没有公告"} />
                        </div>
                    ) : null}

                    {!query.isError && items.length ? (
                        <div className="announcements-feed">
                            {pinnedItems.length ? (
                                <section className="announcements-section" aria-labelledby="pinned-announcements-title">
                                    <h3 id="pinned-announcements-title">
                                        <Pin className="size-4" />
                                        置顶公告
                                    </h3>
                                    <div className="announcements-list">
                                        {pinnedItems.map((item) => (
                                            <AnnouncementCard key={item.id} item={item} reading={readMutation.isPending && readMutation.variables === item.id} onRead={() => readMutation.mutate(item.id)} />
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                            {timelineItems.length ? (
                                <section className="announcements-section" aria-labelledby="timeline-announcements-title">
                                    <h3 id="timeline-announcements-title">
                                        <Megaphone className="size-4" />
                                        {pinnedItems.length ? "更多公告" : "公告时间线"}
                                    </h3>
                                    <div className="announcements-list">
                                        {timelineItems.map((item) => (
                                            <AnnouncementCard key={item.id} item={item} reading={readMutation.isPending && readMutation.variables === item.id} onRead={() => readMutation.mutate(item.id)} />
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                        </div>
                    ) : null}

                    {(query.data?.total || 0) > 10 ? (
                        <div className="announcements-pagination">
                            <Pagination current={page} pageSize={10} total={query.data?.total || 0} showSizeChanger={false} onChange={setPage} />
                        </div>
                    ) : null}
                </div>
            </section>
        </Modal>
    );
}

export default function AnnouncementsRoute() {
    const navigate = useNavigate();
    return <AnnouncementCenterDialog open onClose={() => navigate("/", { replace: true })} />;
}

function AnnouncementCard({ item, reading, onRead }: { item: SystemAnnouncement; reading: boolean; onRead: () => void }) {
    const detail = typeDetails[item.type];
    return (
        <article className={`announcement-card ${item.isRead ? "is-read" : "is-unread"}`} aria-label={item.title}>
            <div className="announcement-card-meta">
                <span>{detail.label}</span>
                {item.pinned ? <span className="announcement-pinned-label"><Pin className="size-3.5" aria-hidden="true" />置顶</span> : null}
                {!item.isRead ? <span className="announcement-unread-label">未读</span> : null}
            </div>
            <h3 className="announcement-title">{item.title}</h3>
            <div className="announcement-content">{item.content}</div>
            <div className="announcement-signature" aria-hidden="true"><span>无限<br />画布</span></div>
            <footer className="announcement-footer">
                <time dateTime={new Date(item.publishedAt || item.createdAt).toISOString()}>{formatAnnouncementDate(item.publishedAt || item.createdAt)} · {item.authorName || "系统管理员"}</time>
                {item.isRead ? <span>已阅</span> : <Button type="text" size="small" loading={reading} onClick={onRead}>我已阅读</Button>}
            </footer>
        </article>
    );
}

function AnnouncementSkeleton() {
    return (
        <div className="announcements-list" aria-hidden="true">
            {[0, 1, 2].map((item) => (
                <div key={item} className="announcement-card announcement-skeleton">
                    <Skeleton active paragraph={{ rows: 2 }} title={{ width: "38%" }} />
                </div>
            ))}
        </div>
    );
}

function formatAnnouncementDate(timestamp: number) {
    return new Date(timestamp).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

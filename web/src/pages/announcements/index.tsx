import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Modal, Pagination, Result, Segmented, Skeleton } from "antd";
import { Bell, CheckCheck, Megaphone, Pin, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchAnnouncements, markAllAnnouncementsRead, markAnnouncementRead, type AnnouncementType, type SystemAnnouncement } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { announcementStyleVariables } from "@/lib/announcement-style";
import "./typography.css";
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
    const feedItems = useMemo(() => [...pinnedItems, ...timelineItems], [pinnedItems, timelineItems]);

    return (
        <Modal className="announcement-center-modal" title={null} aria-labelledby="announcements-heading" closable={{ "aria-label": "关闭仙尊告示" }} open={open} centered width={1040} footer={null} destroyOnHidden afterClose={onAfterClose} onCancel={onClose}>
            <section className="announcements-dialog" aria-label="仙尊告示">
                <header className="announcements-header">
                    <div className="announcements-motes" aria-hidden="true"><i /><i /><i /><i /><i /></div>
                    <div>
                        <h2 id="announcements-heading">仙尊告示</h2>
                        <p>最新平台更新和通知</p>
                    </div>
                    <div className="announcements-header-status" aria-live="polite">
                        <span className={query.data?.unreadCount ? "is-unread" : ""}>
                            <Bell className="size-4" aria-hidden="true" />
                            {query.data?.unreadCount ? `${query.data.unreadCount} 条未读` : query.data ? "已全部阅览" : ""}
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
                        aria-label="公告分类"
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
                                    <span className="announcements-tab-label" aria-label="未读通知">
                                        <Bell className="size-4" />
                                        通知{query.data?.unreadCount ? <b>{query.data.unreadCount}</b> : null}
                                    </span>
                                ),
                            },
                        ]}
                        onChange={(value) => setView(value as AnnouncementView)}
                    />
                    <Button type="text" shape="circle" aria-label="刷新仙尊告示" title="刷新" icon={<RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />} onClick={() => query.refetch()} />
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
                        <section key={view} className="announcements-feed" aria-label={view === "unread" ? "未读通知" : "公告时间线"}>
                            <div className="announcements-list">
                                {feedItems.map((item) => (
                                    <AnnouncementCard key={item.id} item={item} reading={readMutation.isPending && readMutation.variables === item.id} onRead={() => readMutation.mutate(item.id)} />
                                ))}
                            </div>
                        </section>
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

export function AnnouncementCard({ item, reading, onRead }: { item: SystemAnnouncement; reading: boolean; onRead: () => void }) {
    const detail = typeDetails[item.type];
    const TypeIcon = detail.icon;
    return (
        <article className={`announcement-entry ${item.isRead ? "is-read" : "is-unread"}`} style={announcementStyleVariables(item.style)}>
            <div className="announcement-card-meta">
                <span className={`announcement-kind ${detail.className}`}><TypeIcon className="size-3.5" aria-hidden="true" />{detail.label}</span>
                {item.pinned ? <span className="announcement-pinned-label"><Pin className="size-3.5" aria-hidden="true" />置顶</span> : null}
                {!item.isRead ? <span className="announcement-unread-label">未读</span> : null}
            </div>
            <div className="announcement-card">
                <AnnouncementFrame />
                <h3 className="announcement-title">{item.title}</h3>
                <div className="announcement-title-ornament" aria-hidden="true" />
                <div className="announcement-content">{item.content}</div>
                <footer className="announcement-footer">
                    <div className="announcement-publication">
                        <div className="announcement-date">
                            <span>发布时间</span>
                            <time dateTime={new Date(item.publishedAt || item.createdAt).toISOString()}>{formatAnnouncementDate(item.publishedAt || item.createdAt)}</time>
                        </div>
                        <div className="announcement-author">
                            <span>发布者</span>
                            <strong>{item.authorName || "系统管理员"}</strong>
                        </div>
                    </div>
                    {item.isRead ? <span className="announcement-read-status"><CheckCheck className="size-3.5" aria-hidden="true" />已阅</span> : <Button className="announcement-read-action" type="text" size="small" loading={reading} onClick={onRead}>我已阅读</Button>}
                </footer>
                <div className="announcement-landscape" aria-hidden="true" />
            </div>
        </article>
    );
}

function AnnouncementFrame() {
    return (
        <div className="announcement-frame" aria-hidden="true">
            {(["top", "bottom"] as const).map((edge) => (
                <div key={edge} className={`announcement-frame-${edge}`}>
                    {[0, 1, 2, 3, 4].map((piece) => <span key={piece} />)}
                </div>
            ))}
            <div className="announcement-frame-left" />
            <div className="announcement-frame-right" />
        </div>
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

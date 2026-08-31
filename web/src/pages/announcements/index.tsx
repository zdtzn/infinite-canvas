import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Pagination, Result, Segmented, Skeleton, Tag } from "antd";
import { Bell, CheckCheck, ChevronDown, Megaphone, Orbit, Pin, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchAnnouncements, markAllAnnouncementsRead, markAnnouncementRead, type AnnouncementType, type SystemAnnouncement } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import "./announcements.css";

type AnnouncementView = "timeline" | "unread";

const typeDetails: Record<AnnouncementType, { label: string; icon: typeof Megaphone; className: string }> = {
    update: { label: "功能更新", icon: Sparkles, className: "is-update" },
    notice: { label: "平台通知", icon: Megaphone, className: "is-notice" },
    maintenance: { label: "维护提醒", icon: Wrench, className: "is-maintenance" },
};

export default function AnnouncementsPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const [view, setView] = useState<AnnouncementView>("timeline");
    const [page, setPage] = useState(1);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const query = useQuery({
        queryKey: ["announcements", "list", userId, view, page],
        queryFn: () => fetchAnnouncements({ page, pageSize: 10, unreadOnly: view === "unread" }),
        enabled: Boolean(userId),
        staleTime: 20_000,
    });
    const readMutation = useMutation({
        mutationFn: markAnnouncementRead,
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        onError: (error) => message.error(error instanceof Error ? error.message : "标记已读失败"),
    });
    const readAllMutation = useMutation({
        mutationFn: markAllAnnouncementsRead,
        onSuccess: ({ count }) => {
            void queryClient.invalidateQueries({ queryKey: ["announcements"] });
            message.success(count ? `已将 ${count} 条公告标为已读` : "当前没有未读公告");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "全部标记已读失败"),
    });

    useEffect(() => {
        setPage(1);
        setExpandedId(null);
    }, [view]);

    const items = query.data?.items || [];
    const pinnedItems = useMemo(() => items.filter((item) => item.pinned), [items]);
    const timelineItems = useMemo(() => items.filter((item) => !item.pinned), [items]);

    const toggleAnnouncement = (item: SystemAnnouncement) => {
        const opening = expandedId !== item.id;
        setExpandedId(opening ? item.id : null);
        if (opening && !item.isRead) readMutation.mutate(item.id);
    };

    return (
        <main className="announcements-page">
            <div className="announcements-shell">
                <header className="announcements-header">
                    <div>
                        <p className="announcements-eyebrow">SYSTEM NOTICE</p>
                        <h1 className="font-brush">系统公告</h1>
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
                    <Button type="text" icon={<RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />} onClick={() => query.refetch()}>
                        刷新
                    </Button>
                </div>

                {query.isLoading ? <AnnouncementSkeleton /> : null}
                {query.isError ? <Result status="warning" title="公告暂时无法加载" subTitle={query.error instanceof Error ? query.error.message : "请稍后重试"} extra={<Button onClick={() => query.refetch()}>重新加载</Button>} /> : null}
                {!query.isLoading && !query.isError && !items.length ? (
                    <div className="announcements-empty">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={view === "unread" ? "没有未读公告" : "暂时没有公告"} />
                    </div>
                ) : null}

                {!query.isError && items.length ? (
                    <div className="announcements-feed">
                        {pinnedItems.length ? (
                            <section className="announcements-section" aria-labelledby="pinned-announcements-title">
                                <h2 id="pinned-announcements-title">
                                    <Pin className="size-4" />
                                    置顶公告
                                </h2>
                                <div className="announcements-list">
                                    {pinnedItems.map((item) => (
                                        <AnnouncementCard key={item.id} item={item} expanded={expandedId === item.id} onToggle={() => toggleAnnouncement(item)} />
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {timelineItems.length ? (
                            <section className="announcements-section" aria-labelledby="timeline-announcements-title">
                                <h2 id="timeline-announcements-title">
                                    <Megaphone className="size-4" />
                                    {pinnedItems.length ? "更多公告" : "公告时间线"}
                                </h2>
                                <div className="announcements-list">
                                    {timelineItems.map((item) => (
                                        <AnnouncementCard key={item.id} item={item} expanded={expandedId === item.id} onToggle={() => toggleAnnouncement(item)} />
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
        </main>
    );
}

function AnnouncementCard({ item, expanded, onToggle }: { item: SystemAnnouncement; expanded: boolean; onToggle: () => void }) {
    const detail = typeDetails[item.type];
    const Icon = detail.icon;
    const summary = item.summary || item.content.split(/\n+/)[0]?.slice(0, 160) || "查看公告详情";
    return (
        <article className={`announcement-card ${item.isRead ? "is-read" : "is-unread"} ${item.pinned ? "is-pinned" : ""}`}>
            <button type="button" className="announcement-card-trigger" aria-expanded={expanded} onClick={onToggle}>
                <span className={`announcement-type-icon ${detail.className}`}>
                    <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="announcement-card-copy">
                    <span className="announcement-card-meta">
                        <Tag bordered={false} className={detail.className}>
                            {detail.label}
                        </Tag>
                        {item.pinned ? (
                            <span className="announcement-pinned-label">
                                <Pin className="size-3.5" />
                                置顶
                            </span>
                        ) : null}
                        {!item.isRead ? <span className="announcement-unread-label">未读</span> : null}
                    </span>
                    <strong>{item.title}</strong>
                    <span className="announcement-summary">{summary}</span>
                    <span className="announcement-date">
                        {formatAnnouncementTime(item.publishedAt || item.createdAt)} · {item.authorName || "系统管理员"}
                    </span>
                </span>
                <ChevronDown className={`announcement-card-chevron size-4 ${expanded ? "is-expanded" : ""}`} aria-hidden="true" />
            </button>
            {expanded ? (
                <div className="announcement-card-body">
                    <div className="announcement-rule-mark" aria-hidden="true">
                        <Orbit className="size-4" />
                    </div>
                    <div className="announcement-content">{item.content}</div>
                    <footer>
                        <span>{item.isRead ? "已阅" : "正在同步已读状态"}</span>
                        <time dateTime={new Date(item.publishedAt || item.createdAt).toISOString()}>{formatAnnouncementDate(item.publishedAt || item.createdAt)}</time>
                    </footer>
                </div>
            ) : null}
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

function formatAnnouncementTime(timestamp: number) {
    const elapsed = Date.now() - timestamp;
    if (elapsed >= 0 && elapsed < 60_000) return "刚刚";
    if (elapsed >= 0 && elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
    if (elapsed >= 0 && elapsed < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))} 小时前`;
    if (elapsed >= 0 && elapsed < 7 * 24 * 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 86_400_000))} 天前`;
    return formatAnnouncementDate(timestamp);
}

function formatAnnouncementDate(timestamp: number) {
    return new Date(timestamp).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

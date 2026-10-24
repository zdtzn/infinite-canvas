import { useQueryClient } from "@tanstack/react-query";
import { Modal, theme } from "antd";
import { useEffect, useRef, useState } from "react";

import { AnnouncementCard } from "@/pages/announcements";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUnreadAnnouncements } from "@/hooks/use-unread-announcements";
import { markAnnouncementRead } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

export function AnnouncementAutoPrompt() {
    const userId = useUserStore((state) => state.user?.id);
    return PUBLIC_MODE && userId ? <AnnouncementPromptSession key={userId} userId={userId} /> : null;
}

export function AnnouncementPromptSession({ userId }: { userId: string }) {
    const { token } = theme.useToken();
    const queryClient = useQueryClient();
    const query = useUnreadAnnouncements(userId);
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState("");
    const active = useRef(true);
    const pending = useRef(false);
    const item = query.data?.items[0];
    const itemKey = item ? `${item.id}:${item.publishedAt}` : "";

    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    useEffect(() => setError(""), [itemKey]);

    const confirm = async () => {
        if (!item || pending.current) return;
        pending.current = true;
        setConfirming(true);
        setError("");
        const isCurrentSession = () => active.current && useUserStore.getState().user?.id === userId;
        try {
            await markAnnouncementRead(item.id, userId);
            if (!isCurrentSession()) return;
            setHidden((current) => new Set(current).add(itemKey));
            await queryClient.invalidateQueries({ queryKey: ["announcements"] });
        } catch {
            if (isCurrentSession()) setError("阅读记录暂时未能保存");
        } finally {
            pending.current = false;
            if (isCurrentSession()) setConfirming(false);
        }
    };

    const defer = () => {
        if (pending.current) return;
        setHidden((current) => new Set(current).add(itemKey));
        setError("");
    };

    return (
        <Modal
            className="announcement-center-modal announcement-auto-modal"
            open={Boolean(item && !hidden.has(itemKey))}
            title="仙尊告示"
            width={560}
            centered
            destroyOnHidden
            style={{ maxWidth: "calc(100vw - 24px)" }}
            styles={{
                container: { display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 24px)" },
                header: { flexShrink: 0 },
                body: { minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" },
                footer: { flexShrink: 0 },
            }}
            okText="我知道了"
            cancelText="稍后阅读"
            confirmLoading={confirming}
            cancelButtonProps={{ disabled: confirming }}
            closable={!confirming}
            keyboard={!confirming}
            mask={{ closable: !confirming }}
            onOk={() => void confirm()}
            onCancel={defer}
        >
            {item ? (
                <div className="announcement-preview">
                    <AnnouncementCard item={item} reading={confirming} onRead={() => void confirm()} />
                    {error ? <p className="announcement-prompt-error" role="alert" style={{ color: token.colorError }}>{error}。请再次点击“我知道了”重试。</p> : null}
                </div>
            ) : null}
        </Modal>
    );
}

import { useQueryClient } from "@tanstack/react-query";
import { Modal, theme } from "antd";
import { useEffect, useRef, useState } from "react";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUnreadAnnouncements } from "@/hooks/use-unread-announcements";
import { userFacingErrorMessage } from "@/lib/friendly-error";
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
    const itemKey = item ? `${item.id}:${item.updatedAt}` : "";

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
        } catch (reason) {
            if (isCurrentSession()) setError(userFacingErrorMessage(reason, "暂时未能确认已读，请稍后重试"));
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
            open={Boolean(item && !hidden.has(itemKey))}
            title="系统公告"
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
                <article className="space-y-4 break-words">
                    <h2 className="pr-4 text-lg font-semibold leading-relaxed">{item.title}</h2>
                    {item.summary ? <p style={{ color: token.colorTextSecondary }}>{item.summary}</p> : null}
                    <div className="whitespace-pre-wrap leading-7" style={{ overflowWrap: "anywhere" }}>{item.content}</div>
                    {error ? <p role="alert" style={{ color: token.colorError }}>{error}。请再次点击“我知道了”重试。</p> : null}
                </article>
            ) : null}
        </Modal>
    );
}

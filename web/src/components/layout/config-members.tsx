import { App, Button, Empty, Tag } from "antd";
import { UserRoundCheck, UserRoundX } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchServerMembers, updateServerMember, type ServerMember } from "@/services/server-api";

export function ConfigMembers() {
    const { message } = App.useApp();
    const [members, setMembers] = useState<ServerMember[]>([]);
    const [loadingId, setLoadingId] = useState("");

    const refresh = async () => setMembers((await fetchServerMembers()).items);
    useEffect(() => {
        void refresh().catch((error) => message.error(error instanceof Error ? error.message : "成员加载失败"));
    }, []);

    const toggle = async (member: ServerMember) => {
        setLoadingId(member.userId);
        try {
            await updateServerMember(member.userId, !member.disabled);
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "成员状态更新失败");
        } finally {
            setLoadingId("");
        }
    };

    return (
        <div className="space-y-2">
            <div className="mb-4 text-xs text-stone-500">成员使用同一个访问口令登录，但渠道、任务和项目备份按成员隔离。管理员可以随时停用朋友的访问。</div>
            {members.map((member) => (
                <div key={member.userId} className="flex items-center justify-between gap-3 border-b border-stone-200 py-3 last:border-b-0 dark:border-stone-800">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{member.displayName}</div>
                        <div className="mt-1 text-xs text-stone-500">{new Date(member.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Tag className="m-0" color={member.admin ? "blue" : member.disabled ? "error" : "success"}>{member.admin ? "管理员" : member.disabled ? "已停用" : "可访问"}</Tag>
                        {!member.admin ? (
                            <Button size="small" danger={!member.disabled} loading={loadingId === member.userId} icon={member.disabled ? <UserRoundCheck className="size-3.5" /> : <UserRoundX className="size-3.5" />} onClick={() => void toggle(member)}>
                                {member.disabled ? "恢复" : "停用"}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ))}
            {!members.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无成员" /> : null}
        </div>
    );
}

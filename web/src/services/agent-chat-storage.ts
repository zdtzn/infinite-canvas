import localforage from "localforage";

import { upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import type { AgentAttachment, AgentChatItem } from "@/stores/use-agent-store";
import { useUserStore } from "@/stores/use-user-store";

export type StoredAgentUserMessage = Pick<AgentChatItem, "id" | "text" | "attachments"> & { role: "user"; historyText: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_chat_messages" });

export function agentChatIndexKey(userId: string, threadId: string) {
    return `user:${encodeURIComponent(userId || "anonymous")}:thread:${threadId}`;
}

export function agentChatMessageKey(userId: string, threadId: string, messageId: string) {
    return `${agentChatIndexKey(userId, threadId)}:message:${messageId}`;
}

const currentUserId = () => useUserStore.getState().user?.id || "anonymous";

export async function saveAgentUserMessage(threadId: string, message: StoredAgentUserMessage) {
    if (!message.attachments?.length) return;
    const userId = currentUserId();
    const attachments = await Promise.all((message.attachments || []).map(createThumbnail));
    await store.setItem(agentChatMessageKey(userId, threadId, message.id), { ...message, attachments });
    const indexKey = agentChatIndexKey(userId, threadId);
    const ids = (await store.getItem<string[]>(indexKey)) || [];
    if (!ids.includes(message.id)) await store.setItem(indexKey, [...ids, message.id]);
}

export async function readAgentUserMessages(threadId: string) {
    const userId = currentUserId();
    const ids = (await store.getItem<string[]>(agentChatIndexKey(userId, threadId))) || [];
    return (await Promise.all(ids.map((id) => store.getItem<StoredAgentUserMessage>(agentChatMessageKey(userId, threadId, id))))).filter((item): item is StoredAgentUserMessage => Boolean(item));
}

export async function deleteAgentThreadMessages(threadIds: string[]) {
    const userId = currentUserId();
    await Promise.all(
        threadIds.map(async (threadId) => {
            const indexKey = agentChatIndexKey(userId, threadId);
            const ids = (await store.getItem<string[]>(indexKey)) || [];
            await Promise.all(ids.map((id) => store.removeItem(agentChatMessageKey(userId, threadId, id))));
            await store.removeItem(indexKey);
        }),
    );
}

async function createThumbnail(attachment: AgentAttachment): Promise<AgentAttachment> {
    const dataUrl = Math.max(attachment.width, attachment.height) > 512 ? await upscaleDataUrl(attachment.dataUrl, { targetLongEdge: 512, algorithm: "high" }) : attachment.dataUrl;
    return { ...attachment, size: dataUrl.length, url: dataUrl, dataUrl };
}

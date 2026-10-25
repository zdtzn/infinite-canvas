import localforage from "localforage";
import { useCallback, useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

import type { ChatAttachment } from "@/services/chat-api";
import { chatDraftKey, createChatDraftRepository } from "./chat-draft-storage";

const repository = createChatDraftRepository(localforage.createInstance({ name: "infinite-canvas", storeName: "chat_drafts", driver: localforage.INDEXEDDB }));

export function useChatDraft(userId: string, conversationId: string) {
    const key = chatDraftKey(userId, conversationId);
    const subscribe = useCallback((listener: () => void) => repository.subscribe(key, listener), [key]);
    const getSnapshot = useCallback(() => repository.getSnapshot(key), [key]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => { void repository.load(key); }, [key]);
    const setDraft: Dispatch<SetStateAction<string>> = useCallback((value) => repository.setDraft(key, value), [key]);
    const setAttachments: Dispatch<SetStateAction<ChatAttachment[]>> = useCallback((value) => repository.setAttachments(key, value), [key]);
    // Keep the callback captured when sending; a later acknowledgement must not
    // remove text or attachments entered while that request was in flight.
    const clearDraft = useCallback(() => repository.clear(key, snapshot.revision), [key, snapshot.revision]);
    const moveDraft = useCallback((targetConversationId: string) => repository.move(key, chatDraftKey(userId, targetConversationId), snapshot.revision), [key, userId, snapshot.revision]);
    return { ...snapshot, setDraft, setAttachments, clearDraft, moveDraft };
}

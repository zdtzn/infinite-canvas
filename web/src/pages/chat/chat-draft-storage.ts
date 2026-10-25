import type { ChatAttachment } from "@/services/chat-api";

export type ChatDraftValue = { draft: string; attachments: ChatAttachment[] };
export type ChatDraftSnapshot = ChatDraftValue & { ready: boolean; revision: number; storageError: boolean };
export type ChatDraftStorage = {
    getItem(key: string): Promise<unknown>;
    setItem(key: string, value: ChatDraftValue): Promise<unknown>;
    removeItem(key: string): Promise<unknown>;
};

export function chatDraftKey(userId: string, conversationId: string) {
    return userId ? JSON.stringify([userId, conversationId]) : "";
}

function storedDraft(value: unknown): ChatDraftValue {
    const record = value && typeof value === "object" ? (value as Partial<ChatDraftValue>) : {};
    return {
        draft: typeof record.draft === "string" ? record.draft : "",
        attachments: Array.isArray(record.attachments)
            ? record.attachments.flatMap((item) => {
                  if (!item || typeof item.assetKey !== "string" || !item.assetKey || /^(data|blob):/i.test(item.assetKey) || typeof item.mimeType !== "string" || typeof item.name !== "string") return [];
                  const attachment: ChatAttachment = { assetKey: item.assetKey, mimeType: item.mimeType, name: item.name };
                  if (typeof item.url === "string" && /^(https?:\/\/|\/)/i.test(item.url)) attachment.url = item.url;
                  return [attachment];
              })
            : [],
    };
}

// Each key owns its read, write queue and revision so switching accounts or sessions
// cannot apply an old read or send acknowledgement to the current composer.
export function createChatDraftRepository(storage: ChatDraftStorage) {
    type Entry = {
        snapshot: ChatDraftSnapshot;
        listeners: Set<() => void>;
        loading?: Promise<void>;
        writing: Promise<void>;
        edited: { draft: boolean; attachments: boolean };
    };
    const entries = new Map<string, Entry>();
    function entry(key: string): Entry {
        let current = entries.get(key);
        if (!current) {
            current = { snapshot: { draft: "", attachments: [], ready: !key, revision: 0, storageError: false }, listeners: new Set(), writing: Promise.resolve(), edited: { draft: false, attachments: false } };
            entries.set(key, current);
        }
        return current;
    }
    function publish(current: Entry, patch: Partial<ChatDraftSnapshot>) {
        current.snapshot = { ...current.snapshot, ...patch };
        current.listeners.forEach((listener) => listener());
    }
    function persist(key: string, current: Entry) {
        if (!key || !current.snapshot.ready) return;
        const value = storedDraft(current.snapshot);
        current.writing = current.writing
            .then(() => (value.draft || value.attachments.length ? storage.setItem(key, value) : storage.removeItem(key)))
            .then(() => {
                if (current.snapshot.storageError) publish(current, { storageError: false });
            })
            .catch(() => publish(current, { storageError: true }));
    }
    function load(key: string): Promise<void> {
        const current = entry(key);
        if (current.snapshot.ready) return Promise.resolve();
        if (!current.loading) {
            current.loading = Promise.resolve()
                .then(() => storage.getItem(key))
                .then((value) => {
                    const saved = storedDraft(value);
                    publish(current, { draft: current.edited.draft ? current.snapshot.draft : saved.draft, attachments: current.edited.attachments ? current.snapshot.attachments : saved.attachments, ready: true });
                })
                .catch(() => publish(current, { ready: true, storageError: true }))
                .then(() => {
                    if (current.edited.draft || current.edited.attachments) persist(key, current);
                });
        }
        return current.loading;
    }
    function update(key: string, patch: Partial<ChatDraftValue>) {
        const current = entry(key);
        if (patch.draft !== undefined) current.edited.draft = true;
        if (patch.attachments !== undefined) current.edited.attachments = true;
        publish(current, { ...patch, revision: current.snapshot.revision + 1 });
        if (current.snapshot.ready) persist(key, current);
        else void load(key);
    }
    function clear(key: string, revision: number) {
        if (entry(key).snapshot.revision === revision) update(key, { draft: "", attachments: [] });
    }
    return {
        getSnapshot: (key: string) => entry(key).snapshot,
        subscribe(key: string, listener: () => void) {
            const current = entry(key);
            current.listeners.add(listener);
            return () => { current.listeners.delete(listener); };
        },
        load,
        setDraft(key: string, value: string | ((current: string) => string)) {
            update(key, { draft: typeof value === "function" ? value(entry(key).snapshot.draft) : value });
        },
        setAttachments(key: string, value: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])) {
            update(key, { attachments: typeof value === "function" ? value(entry(key).snapshot.attachments) : value });
        },
        clear,
        move(fromKey: string, toKey: string, submittedRevision = entry(fromKey).snapshot.revision) {
            const source = entry(fromKey).snapshot;
            if (!source.ready) return () => {};
            if (fromKey !== toKey && source.ready) {
                update(toKey, { draft: source.draft, attachments: source.attachments });
                clear(fromKey, source.revision);
            }
            const revision = entry(toKey).snapshot.revision;
            return () => { if (source.revision === submittedRevision) clear(toKey, revision); };
        },
        async whenIdle(key: string) {
            await load(key);
            await entry(key).writing;
        },
    };
}

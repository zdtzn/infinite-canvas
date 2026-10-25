import { describe, expect, test } from "bun:test";

import { chatDraftKey, createChatDraftRepository, type ChatDraftStorage, type ChatDraftValue } from "./chat-draft-storage";

const attachment = { assetKey: "users/a/chat/picture.png", mimeType: "image/png", name: "图片.png", url: "/api/assets/picture.png" };
const key = chatDraftKey("account-a", "conversation-a");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function memoryStorage() {
    const values = new Map<string, unknown>();
    const writes: Array<{ key: string; value: ChatDraftValue | null }> = [];
    const storage: ChatDraftStorage = {
        async getItem(key) { return values.get(key) ?? null; },
        async setItem(key, value) { values.set(key, structuredClone(value)); writes.push({ key, value }); },
        async removeItem(key) { values.delete(key); writes.push({ key, value: null }); },
    };
    return { storage, values, writes };
}

describe("ordinary chat drafts", () => {
    test("separates accounts, conversations and the new-conversation composer", () => {
        expect(key).not.toBe(chatDraftKey("account-b", "conversation-a"));
        expect(key).not.toBe(chatDraftKey("account-a", "conversation-b"));
        expect(chatDraftKey("account-a", "")).not.toBe(chatDraftKey("account-a", "new"));
        expect(chatDraftKey("a,b", "c")).not.toBe(chatDraftKey("a", "b,c"));
        expect(chatDraftKey("", "conversation-a")).toBe("");
    });

    test("restores text and server attachment references after reopening", async () => {
        const { storage } = memoryStorage();
        const first = createChatDraftRepository(storage);
        await first.load(key);
        first.setDraft(key, "  下次继续的问题\n第二行");
        first.setAttachments(key, (current) => [...current, attachment]);
        await first.whenIdle(key);

        const reopened = createChatDraftRepository(storage);
        await reopened.load(key);
        expect(reopened.getSnapshot(key)).toMatchObject({ draft: "  下次继续的问题\n第二行", attachments: [attachment], ready: true });
    });

    test("edits during hydration preserve typed text and load saved attachments", async () => {
        const { storage, values } = memoryStorage();
        const read = deferred<unknown>();
        const repository = createChatDraftRepository({ ...storage, getItem: () => read.promise });
        const loading = repository.load(key);
        repository.setDraft(key, "new text before IndexedDB resolves");
        read.resolve({ draft: "old text", attachments: [attachment] });
        await loading;
        await repository.whenIdle(key);
        expect(repository.getSnapshot(key)).toMatchObject({ draft: "new text before IndexedDB resolves", attachments: [attachment], ready: true });
        expect(values.get(key)).toEqual({ draft: "new text before IndexedDB resolves", attachments: [attachment] });
    });

    test("rapid A to B to A loads cannot apply one session or account to another", async () => {
        const a = deferred<unknown>();
        const b = deferred<unknown>();
        const keyB = chatDraftKey("account-b", "conversation-a");
        const { storage } = memoryStorage();
        const repository = createChatDraftRepository({ ...storage, getItem: (target) => target === key ? a.promise : b.promise });
        const loadA = repository.load(key);
        const loadB = repository.load(keyB);
        expect(repository.load(key)).toBe(loadA);
        repository.setDraft(key, "A updated while away");
        b.resolve({ draft: "B private", attachments: [] });
        await loadB;
        a.resolve({ draft: "A old", attachments: [attachment] });
        await loadA;
        expect(repository.getSnapshot(key).draft).toBe("A updated while away");
        expect(repository.getSnapshot(keyB).draft).toBe("B private");
        expect(repository.getSnapshot(keyB).attachments).toEqual([]);
    });

    test("serializes saves and clears so an old write cannot resurrect a sent draft", async () => {
        const { storage, values, writes } = memoryStorage();
        const firstWrite = deferred<void>();
        const started = deferred<void>();
        let count = 0;
        const repository = createChatDraftRepository({ ...storage, async setItem(target, value) {
            if (++count === 1) { started.resolve(); await firstWrite.promise; }
            return storage.setItem(target, value);
        } });
        await repository.load(key);
        repository.setDraft(key, "first");
        await started.promise;
        repository.setDraft(key, "second");
        repository.clear(key, repository.getSnapshot(key).revision);
        expect(writes).toHaveLength(0);
        firstWrite.resolve();
        await repository.whenIdle(key);
        expect(writes.map((write) => write.value?.draft ?? null)).toEqual(["first", "second", null]);
        expect(values.has(key)).toBe(false);
    });

    test("a late send acknowledgement preserves a newer draft even with identical text", async () => {
        const { storage, values } = memoryStorage();
        const repository = createChatDraftRepository(storage);
        await repository.load(key);
        repository.setDraft(key, "same question");
        const submittedRevision = repository.getSnapshot(key).revision;
        repository.clear(key, submittedRevision);
        repository.setDraft(key, "same question");
        repository.setAttachments(key, [attachment]);
        repository.clear(key, submittedRevision);
        await repository.whenIdle(key);
        expect(values.get(key)).toEqual({ draft: "same question", attachments: [attachment] });
    });

    test("late clears target only their originating conversation and account", async () => {
        const { storage } = memoryStorage();
        const repository = createChatDraftRepository(storage);
        const keyB = chatDraftKey("account-b", "conversation-a");
        await Promise.all([repository.load(key), repository.load(keyB)]);
        repository.setDraft(key, "A submitted");
        repository.setDraft(keyB, "B private");
        repository.clear(key, repository.getSnapshot(key).revision);
        expect(repository.getSnapshot(key).draft).toBe("");
        expect(repository.getSnapshot(keyB).draft).toBe("B private");
    });

    test("transfers the blank composer and returns a safe clearer for first-send acceptance", async () => {
        const { storage, values } = memoryStorage();
        const repository = createChatDraftRepository(storage);
        const blankKey = chatDraftKey("account-a", "");
        await repository.load(blankKey);
        repository.setDraft(blankKey, "first question");
        repository.setAttachments(blankKey, [attachment]);
        const clearTransferred = repository.move(blankKey, key);
        repository.setDraft(blankKey, "another new conversation");
        await Promise.all([repository.whenIdle(blankKey), repository.whenIdle(key)]);
        expect(values.get(key)).toEqual({ draft: "first question", attachments: [attachment] });
        clearTransferred();
        await repository.whenIdle(key);
        expect(values.has(key)).toBe(false);
        expect(repository.getSnapshot(blankKey).draft).toBe("another new conversation");
    });

    test("never persists attachment blobs, inline data or unknown fields", async () => {
        const { storage, values } = memoryStorage();
        const repository = createChatDraftRepository(storage);
        await repository.load(key);
        repository.setAttachments(key, [
            { ...attachment, url: "data:image/png;base64,secret", dataUrl: "secret", blob: new Blob(["secret"]) } as typeof attachment,
            { ...attachment, assetKey: "blob:temporary" },
        ]);
        await repository.whenIdle(key);
        expect(values.get(key)).toEqual({ draft: "", attachments: [{ assetKey: attachment.assetKey, mimeType: attachment.mimeType, name: attachment.name }] });
    });

    test("first conversation creation migrates later edits without clearing them on acceptance", async () => {
        const { storage } = memoryStorage();
        const repository = createChatDraftRepository(storage);
        const blankKey = chatDraftKey("account-a", "");
        await repository.load(blankKey);
        repository.setDraft(blankKey, "submitted question");
        const submittedRevision = repository.getSnapshot(blankKey).revision;
        repository.setDraft(blankKey, "new text typed while creation was pending");
        const clearTransferred = repository.move(blankKey, key, submittedRevision);
        await repository.whenIdle(key);
        clearTransferred();
        expect(repository.getSnapshot(key).draft).toBe("new text typed while creation was pending");
        expect(repository.getSnapshot(blankKey).draft).toBe("");
    });

    test("retains in-memory work and reports failed persistence, allowing a later save", async () => {
        const { storage, values } = memoryStorage();
        let fail = true;
        const repository = createChatDraftRepository({ ...storage, async setItem(target, value) {
            if (fail) throw new Error("IndexedDB unavailable");
            return storage.setItem(target, value);
        } });
        await repository.load(key);
        repository.setDraft(key, "keep this text");
        await repository.whenIdle(key);
        expect(repository.getSnapshot(key)).toMatchObject({ draft: "keep this text", storageError: true });
        fail = false;
        repository.setDraft(key, (current) => `${current}!`);
        await repository.whenIdle(key);
        expect(repository.getSnapshot(key).storageError).toBe(false);
        expect(values.get(key)).toEqual({ draft: "keep this text!", attachments: [] });
    });
});

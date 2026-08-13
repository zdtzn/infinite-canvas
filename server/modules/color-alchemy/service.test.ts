import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import { ColorAlchemyError, createColorAlchemyService } from "./service";

const directories: string[] = [];

afterEach(() => {
    while (directories.length)
        try {
            rmSync(directories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
        }
});

describe("color alchemy service", () => {
    test("isolates drafts and referenced assets by account", () => {
        const { store, service } = setup();
        try {
            service.saveDocument("user-a", "draft", payload("image:a", "image:a-reference", 1));
            service.saveDocument("user-b", "draft", payload("image:b", undefined, 1));

            expect(service.listDocuments("user-a").items).toHaveLength(1);
            expect(service.listDocuments("user-a").items[0].source.storageKey).toBe("image:a");
            expect(service.listDocuments("user-b").items[0].source.storageKey).toBe("image:b");
            expect(service.assetReferenceRoots("user-a")).toEqual([{ storageKey: "image:a" }, { storageKey: "image:a-reference" }]);
            expect(service.deleteDocument("user-b", "draft").id).toBe("draft");
            expect(service.listDocuments("user-a").items).toHaveLength(1);
        } finally {
            store.close();
        }
    });

    test("rejects a draft that references another account's image", () => {
        const { store, service } = setup();
        try {
            expect(() => service.saveDocument("user-a", "draft", payload("image:b", undefined, 1))).toThrow(ColorAlchemyError);
            expect(service.listDocuments("user-a").items).toEqual([]);
        } finally {
            store.close();
        }
    });

    test("keeps only the twelve most recently saved drafts", () => {
        const { store, service, advanceTime } = setup();
        try {
            for (let index = 0; index < 13; index += 1) {
                advanceTime();
                service.saveDocument("user-a", `draft-${index}`, payload("image:a", undefined, index + 1));
            }

            const documents = service.listDocuments("user-a").items;
            expect(documents).toHaveLength(12);
            expect(documents.some((document) => document.id === "draft-0")).toBe(false);
            expect(documents[0].id).toBe("draft-12");
        } finally {
            store.close();
        }
    });

    test("keeps a deletion tombstone authoritative over a stale draft save", () => {
        const { store, service, advanceTime } = setup();
        try {
            service.saveDocument("user-a", "draft", payload("image:a", undefined, 1));
            advanceTime();
            const deleted = service.deleteDocument("user-a", "draft");
            const staleSave = service.saveDocument("user-a", "draft", payload("image:a", undefined, 1));

            expect(staleSave).toEqual({ kind: "deleted", deleted });
            expect(service.listDocuments("user-a").items).toEqual([]);
            expect(service.listDocuments("user-a").deleted).toEqual([deleted]);
        } finally {
            store.close();
        }
    });
});

function setup() {
    const dataDir = mkdtempSync(join(tmpdir(), "color-alchemy-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    const state = store.loadState();
    state.users = {
        "user-a": { userId: "user-a", displayName: "User A", createdAt: 1 },
        "user-b": { userId: "user-b", displayName: "User B", createdAt: 1 },
    };
    store.saveState(state);
    for (const [userId, key] of [["user-a", "image:a"], ["user-a", "image:a-reference"], ["user-b", "image:b"]] as const) {
        store.raw!.query("INSERT INTO assets(asset_key, user_id, mime_type, bytes, created_at) VALUES (?, ?, 'image/png', 100, ?)").run(key, userId, 1);
    }
    let timestamp = 1_000;
    return {
        store,
        service: createColorAlchemyService(store.raw!, { now: () => timestamp }),
        advanceTime: () => {
            timestamp += 1_000;
        },
    };
}

function payload(storageKey: string, referenceStorageKey?: string, updatedAt = 1) {
    return {
        source: { key: storageKey, title: "原图", storageKey, width: 100, height: 100, mimeType: "image/png" },
        ...(referenceStorageKey ? { reference: { key: referenceStorageKey, title: "参考图", storageKey: referenceStorageKey, width: 100, height: 100, mimeType: "image/png", analysis: { luminance: 0.5 } } } : {}),
        settings: { exposure: 0 },
        history: [{ exposure: 0 }],
        historyIndex: 0,
        updatedAt: new Date(updatedAt * 1_000).toISOString(),
    };
}

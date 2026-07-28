import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createMediaTaskStore } from "./media-task-store";

let database: Database | null = null;

afterEach(() => {
    database?.close();
    database = null;
});

describe("media task ownership", () => {
    test("binds a provider task to the submitting account and usage record", () => {
        const store = setup();
        store.register({ usageId: "usage-a", userId: "user-a", channelId: "channel", kind: "video", taskId: "task-1" });

        expect(store.isOwnedBy("user-a", "channel", "video", "task-1")).toBe(true);
        expect(store.isOwnedBy("user-b", "channel", "video", "task-1")).toBe(false);
        expect(store.getByUsageId("usage-a")?.taskId).toBe("task-1");
        expect(store.countActiveForUser("user-a")).toBe(1);
        store.markFinished("channel", "video", "task-1");
        expect(store.countActiveForUser("user-a")).toBe(0);
    });

    test("does not allow an existing task or usage id to be reassigned", () => {
        const store = setup();
        store.register({ usageId: "usage-a", userId: "user-a", channelId: "channel", kind: "content", taskId: "task-1" });

        expect(() => store.register({ usageId: "usage-a", userId: "user-b", channelId: "channel", kind: "content", taskId: "task-2" })).toThrow("归属记录发生冲突");
        expect(() => store.register({ usageId: "usage-b", userId: "user-b", channelId: "channel", kind: "content", taskId: "task-1" })).toThrow("归属记录发生冲突");
    });

    test("expires abandoned active tasks so they cannot hold concurrency forever", () => {
        const store = setup(60_000);
        store.register({ usageId: "usage-a", userId: "user-a", channelId: "channel", kind: "video", taskId: "task-1", createdAt: 1_000 });

        expect(store.countActiveForUser("user-a", 30_000)).toBe(1);
        expect(store.countActiveForUser("user-a", 62_000)).toBe(0);
        expect(store.isOwnedBy("user-a", "channel", "video", "task-1")).toBe(true);
    });
});

function setup(activeTtlMs = 2 * 60 * 60_000) {
    database = new Database(":memory:", { strict: true });
    database.exec(`
        CREATE TABLE media_task_ownership (
            usage_id TEXT NOT NULL UNIQUE,
            user_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            task_kind TEXT NOT NULL CHECK (task_kind IN ('video', 'content')),
            task_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            task_status TEXT NOT NULL DEFAULT 'active' CHECK (task_status IN ('active', 'finished')),
            finished_at INTEGER,
            PRIMARY KEY (channel_id, task_kind, task_id)
        );
    `);
    return createMediaTaskStore(database, 30 * 24 * 60 * 60_000, activeTtlMs);
}

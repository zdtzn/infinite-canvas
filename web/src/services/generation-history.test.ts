import { describe, expect, test } from "bun:test";

import { mergeGenerationHistoryRecords, reconcileGenerationHistoryRecords, recordBelongsToUser, splitGenerationHistoryBatches } from "./generation-history";

describe("generation history synchronization", () => {
    test("merges local and remote records without dropping either side", () => {
        const merged = mergeGenerationHistoryRecords(
            [
                { id: "local-only", createdAt: 1, updatedAt: 1 },
                { id: "shared", createdAt: 2, updatedAt: 30, value: "local-newer" },
            ],
            [
                { id: "remote-only", createdAt: 3, updatedAt: 3 },
                { id: "shared", createdAt: 2, updatedAt: 20, value: "remote-older" },
            ],
        );

        expect(merged.map((item) => item.id)).toEqual(["shared", "remote-only", "local-only"]);
        expect(merged.find((item) => item.id === "shared")).toMatchObject({ value: "local-newer" });
    });

    test("claims legacy unowned records once and isolates records owned by another user", () => {
        expect(recordBelongsToUser({ id: "legacy", createdAt: 1 }, "alice")).toBe(true);
        expect(recordBelongsToUser({ id: "alice", createdAt: 1, ownerUserId: "alice" }, "alice")).toBe(true);
        expect(recordBelongsToUser({ id: "bob", createdAt: 1, ownerUserId: "bob" }, "alice")).toBe(false);
    });

    test("keeps every local record when a server merge fails", () => {
        const local = [
            { id: "prepared", createdAt: 1, updatedAt: 10 },
            { id: "prepare-failed", createdAt: 2, updatedAt: 20 },
        ];
        const remote = [{ id: "remote", createdAt: 3, updatedAt: 30 }];

        expect(reconcileGenerationHistoryRecords(local, [local[1]], remote, false).map((item) => item.id)).toEqual(["remote", "prepare-failed", "prepared"]);
    });

    test("splits oversized migration uploads into bounded requests", () => {
        const payload = "x".repeat(400_000);
        const records = Array.from({ length: 40 }, (_, index) => ({
            id: `record-${index}`,
            createdAt: index + 1,
            payload,
        }));

        const batches = splitGenerationHistoryBatches(records);

        expect(batches.length).toBeGreaterThan(1);
        expect(batches.flat()).toHaveLength(records.length);
        expect(Math.max(...batches.map((batch) => new TextEncoder().encode(JSON.stringify(batch)).byteLength))).toBeLessThan(7 * 1024 * 1024);
    });
});

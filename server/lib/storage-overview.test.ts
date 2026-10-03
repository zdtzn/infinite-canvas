import { describe, expect, test } from "bun:test";
import { buildStorageOverview, indexStorageReferences, planStorageCleanup } from "./storage-overview";
import type { StoredAsset } from "../types";

const asset = (key: string, bytes = 100, createdAt = 1, userId = "alice"): StoredAsset => ({ key, bytes, createdAt, userId, mimeType: "image/png" });
const assets = [asset("image:kept", 400), asset("image:unused", 300), asset("image:recent", 200, 950), asset("image:foreign", 999, 1, "bob")];
const references = indexStorageReferences([{ label: "画布：海报", value: { nodes: [{ storageKey: "image:kept" }] } }]);
const input = { assets, userId: "alice", references, now: 1_000, graceMs: 100 };

describe("personal storage overview", () => {
    test("isolates accounts and distinguishes referenced, protected and reclaimable bytes", () => {
        const result = buildStorageOverview({ ...input, limitBytes: 1_000, page: 1, pageSize: 2 });
        expect(result.usedBytes).toBe(900);
        expect(result.remainingBytes).toBe(100);
        expect(result.reclaimableBytes).toBe(300);
        expect(result.protectedBytes).toBe(200);
        expect(result.referencedBytes).toBe(400);
        expect(result.total).toBe(3);
        expect(result.items.map(item => item.key)).toEqual(["image:kept", "image:unused"]);
        expect(result.items[0].references).toEqual(["画布：海报"]);
        expect(result.byKind).toEqual([{ kind: "image", bytes: 900, count: 3 }]);
    });

    test("filters unused files and protects files within the grace period", () => {
        const result = buildStorageOverview({ ...input, limitBytes: 800, filter: "unused", page: 1, pageSize: 20 });
        expect(result.items.map(item => item.key)).toEqual(["image:unused"]);
        expect(result.remainingBytes).toBe(0);
        expect(result.totalFiles).toBe(3);
    });

    test("cleanup revalidates fresh references, rejects foreign keys, and deduplicates", () => {
        const freshReferences = indexStorageReferences([{ label: "新画布", value: { storageKey: "image:unused" } }]);
        const result = planStorageCleanup({ ...input, references: freshReferences, keys: ["image:unused", "image:recent", "image:foreign", "image:kept", "image:kept"] });
        expect(result.removable.map(item => item.key)).toEqual(["image:kept"]);
        expect(result.skipped.map(item => item.reason)).toEqual(["referenced", "recent", "missing"]);
    });

    test("deduplicates reference labels and never interprets arbitrary prose as a reference", () => {
        const indexed = indexStorageReferences([{ label: "藏卷阁", value: [{ storageKey: "image:kept" }, { thumbnailKey: "image:kept" }, { prompt: "image:unused" }] }]);
        expect(indexed.get("image:kept")).toEqual(["藏卷阁"]);
        expect(indexed.has("image:unused")).toBe(false);
    });

    test("bounds pagination and omits raw payloads and owner ids", () => {
        const result = buildStorageOverview({ ...input, limitBytes: 1_000, page: NaN, pageSize: Infinity });
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
        expect(result.items[0]).not.toHaveProperty("userId");
    });
});

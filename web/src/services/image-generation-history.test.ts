import { describe, expect, test } from "bun:test";

import { loadImageHistoryRecoveryIndex, mergePersistedImagesIntoHistoryRecord, mergeServerJobsIntoImageHistory, serverJobModelValue } from "./image-generation-history";
import { fetchServerGenerationHistory, type ServerJob } from "./server-api";

type History = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    prompt: string;
    model: string;
    images: Array<{ id: string; dataUrl?: string; persisted?: boolean; serverJobId?: string }>;
    thumbnails?: string[];
    serverJobIds?: string[];
};

describe("server job history recovery", () => {
    test("keeps distinct jobs with identical prompts separate during recovery", () => {
        const jobs = [createJob("a", "image-a"), createJob("b", "image-b")];
        const recovered = mergeServerJobsIntoImageHistory<History>([], jobs, recoveryRecord);
        expect(recovered).toHaveLength(2);
        expect(recovered.flatMap((record) => record.images.map((image) => image.id)).sort()).toEqual(["image-a", "image-b"]);
        expect(mergeServerJobsIntoImageHistory(recovered, jobs, recoveryRecord)).toEqual(recovered);
    });

    test("repairs missing images in an already associated group without duplicating or replacing saved assets", () => {
        const jobs = [createJob("a", "image-a"), createJob("b", "image-b")];
        const group = { ...recoveryRecord(jobs[0]), id: "group", serverJobIds: ["a", "b"], imageCount: 1, successCount: 1,
            images: [{ id: "image-a", dataUrl: "/api/assets/saved-a", persisted: true }], thumbnails: ["/api/assets/saved-a"] };
        const recovered = mergeServerJobsIntoImageHistory([group], jobs, (job) => ({ ...recoveryRecord(job), imageCount: 1, successCount: 1, thumbnails: [] }));
        expect(recovered).toHaveLength(1);
        expect(recovered[0].images.map((image) => image.id)).toEqual(["image-a", "image-b"]);
        expect(recovered[0].images[0].dataUrl).toBe("/api/assets/saved-a");
        expect(recovered[0].imageCount).toBe(2);
        expect(recovered[0].successCount).toBe(2);
        expect(recovered[0].thumbnails).toHaveLength(2);
        expect(mergeServerJobsIntoImageHistory(recovered, jobs, recoveryRecord)).toEqual(recovered);
        expect(group.images).toHaveLength(1);
    });

    test("attaches matching jobs to an existing browser record without duplicating it", () => {
        const logs: History[] = [{ id: "local", createdAt: 10, prompt: "A", model: "m", images: [{ id: "image-a" }] }];
        const job = createJob("job-a", "image-a");

        const merged = mergeServerJobsIntoImageHistory(logs, [job], (item) => ({
            id: `server:${item.id}`,
            createdAt: item.createdAt,
            prompt: item.prompt,
            model: item.model,
            images: (item.result?.images || []).map((image) => ({ id: image.id })),
        }));

        expect(merged).toHaveLength(1);
        expect(merged[0].serverJobIds).toEqual(["job-a"]);
    });

    test("repair preserves the requested image count including failed slots", () => {
        const jobs = [createJob("a", "image-a"), createJob("b", "image-b")];
        const group = { ...recoveryRecord(jobs[0]), serverJobIds: ["a", "b"], imageCount: 4, successCount: 1, failCount: 2 };
        const recovered = mergeServerJobsIntoImageHistory([group], jobs, (job) => ({ ...recoveryRecord(job), imageCount: 1, successCount: 1, failCount: 0 }));
        expect(recovered[0].images).toHaveLength(2);
        expect(recovered[0].imageCount).toBe(4);
        expect(recovered[0].successCount).toBe(2);
        expect(recovered[0].failCount).toBe(2);
        expect(mergeServerJobsIntoImageHistory(recovered, jobs, recoveryRecord)).toEqual(recovered);
    });

    test("recovers a server-only workbench job as a history record", () => {
        const job = createJob("job-a", "image-a");
        const merged = mergeServerJobsIntoImageHistory<History>([], [job], (item) => ({
            id: `server:${item.id}`,
            createdAt: item.createdAt,
            prompt: item.prompt,
            model: item.model,
            images: (item.result?.images || []).map((image) => ({ id: image.id })),
        }));

        expect(merged).toEqual([
            {
                id: "server:job-a",
                createdAt: 10,
                prompt: "A",
                model: "m",
                images: [{ id: "image-a" }],
                serverJobIds: ["job-a"],
            },
        ]);
    });

    test("refreshes an older temporary history record from the persisted server job", () => {
        const temporaryUrl = "https://img.uuapi.net/uu-image-temp/result.png";
        const logs: History[] = [
            {
                id: "local",
                createdAt: 10,
                prompt: "A",
                model: "m",
                images: [{ id: "image-a", dataUrl: temporaryUrl, persisted: false }],
                thumbnails: [temporaryUrl],
            },
        ];

        const merged = mergeServerJobsIntoImageHistory(logs, [createJob("job-a", "image-a")], () => {
            throw new Error("existing history should be reused");
        });

        expect(merged).toHaveLength(1);
        expect(merged[0].images[0]).toMatchObject({
            id: "image-a",
            dataUrl: "/api/job-files/job-a/image.png",
            serverJobId: "job-a",
        });
        expect(merged[0].thumbnails).toEqual(["/api/job-files/job-a/image.png"]);
    });

    test("preserves the original channel for duplicate model names", () => {
        const job = { ...createJob("job-channel", "image-channel"), channelId: "sadai", model: "gpt-image-2" };
        expect(serverJobModelValue(job)).toBe("sadai::gpt-image-2");

        const logs: History[] = [{ id: "local", createdAt: 10, prompt: "A", model: "sadai::gpt-image-2", images: [], serverJobIds: [job.id] }];
        const merged = mergeServerJobsIntoImageHistory(logs, [{ ...job, status: "failed", result: undefined }], (item) => ({
            id: `server:${item.id}`,
            createdAt: item.createdAt,
            prompt: item.prompt,
            model: serverJobModelValue(item),
            images: [],
        }));

        expect(merged).toHaveLength(1);
        expect(merged[0].serverJobIds).toEqual(["job-channel"]);
    });

    test("replaces a temporary history image after automatic archiving", () => {
        const record: History = {
            id: "local",
            createdAt: 10,
            prompt: "A",
            model: "m",
            images: [{ id: "image-a", dataUrl: "https://img.uuapi.net/uu-image-temp/result.png", persisted: false }],
            thumbnails: ["https://img.uuapi.net/uu-image-temp/result.png"],
        };

        const merged = mergePersistedImagesIntoHistoryRecord(record, [{ id: "image-a", dataUrl: "/api/job-files/job-a/result.png", persisted: true }], "job-a", 20);

        expect(merged).not.toBe(record);
        expect(merged.images[0]).toEqual({
            id: "image-a",
            dataUrl: "/api/job-files/job-a/result.png",
            persisted: true,
            serverJobId: "job-a",
        });
        expect(merged.thumbnails).toEqual(["/api/job-files/job-a/result.png"]);
        expect(merged.updatedAt).toBe(20);
    });

    test("does not overwrite an already persisted browser asset", () => {
        const record: History = {
            id: "local",
            createdAt: 10,
            prompt: "A",
            model: "m",
            images: [{ id: "image-a", dataUrl: "/api/assets/image-a", persisted: true }],
        };

        expect(mergePersistedImagesIntoHistoryRecord(record, [{ id: "image-a", dataUrl: "/api/job-files/job-a/result.png", persisted: true }], "job-a")).toBe(record);
    });
});

function createJob(id: string, imageId: string): ServerJob {
    return {
        id,
        status: "succeeded",
        createdAt: 10,
        prompt: "A",
        model: "m",
        count: 1,
        source: { route: "/image" },
        result: {
            images: [{ id: imageId, dataUrl: `/api/job-files/${id}/image.png`, bytes: 10, durationMs: 20, mimeType: "image/png", width: 1, height: 1 }],
            successCount: 1,
            failCount: 0,
            durationMs: 20,
        },
    };
}

function recoveryRecord(job: ServerJob): History {
    return { id: `server-job:${job.id}`, createdAt: job.createdAt, prompt: job.prompt, model: serverJobModelValue(job), images: job.result?.images || [], serverJobIds: [job.id] };
}

describe("targeted image recovery index", () => {
    test("transport sends owner-scoped targeted GET queries and preserves ordinary pagination", async () => {
        const originalFetch = globalThis.fetch;
        const originalWindow = globalThis.window;
        const requests: URL[] = [];
        globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
        globalThis.fetch = (async (url, init) => {
            const request = new URL(String(url), "https://test.invalid");
            requests.push(request);
            expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe("owner");
            expect(init?.method || "GET").toBe("GET");
            return Response.json({ items: [], recoveryJobIds: request.searchParams.getAll("recoveryJobId") });
        }) as typeof fetch;
        try {
            await loadImageHistoryRecoveryIndex("owner", [createJob("first", "one"), createJob("second", "two")]);
            expect(requests[0].searchParams.getAll("recoveryJobId")).toEqual(["first", "second"]);
            expect(requests[0].searchParams.has("page")).toBe(false);
            await fetchServerGenerationHistory("image", "owner", { page: 2, pageSize: 18, activeOnly: true });
            expect(requests[1].searchParams.get("page")).toBe("2");
            expect(requests[1].searchParams.get("activeOnly")).toBe("true");
            expect(requests[1].searchParams.has("recoveryJobId")).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
            globalThis.window = originalWindow;
        }
    });
    test("old records outside the visible page are not rewritten; truly missing old jobs recover once", async () => {
        const old = { ...createJob("old", "old-image"), createdAt: 1 };
        const recent = { ...createJob("recent", "recent-image"), createdAt: 500_000 };
        const missing = { ...createJob("missing", "missing-image"), createdAt: 250_000 };
        const remote = [recoveryRecord(recent), recoveryRecord(old)];
        let writes = 0;
        let refetches = 0;
        for (let refresh = 0; refresh < 3; refresh++) {
            const index = await loadImageHistoryRecoveryIndex<History>("user-a", [recent, old, missing, missing], undefined, async (_kind, user, query) => {
                expect(user).toBe("user-a");
                expect(query?.activeOnly).toBeUndefined();
                expect(query?.page).toBeUndefined();
                return { items: [...remote], recoveryJobIds: query?.recoveryJobIds };
            });
            const previous = new Map(index.map((record) => [record.id, record]));
            const changed = mergeServerJobsIntoImageHistory(index, [recent, old, missing, missing], recoveryRecord).filter((record) => JSON.stringify(previous.get(record.id)) !== JSON.stringify(record));
            if (changed.length) refetches++;
            writes += changed.length;
            remote.push(...changed);
        }
        expect(writes).toBe(1);
        expect(refetches).toBe(1);
        expect(remote.map((record) => record.id).sort()).toEqual(["server-job:missing", "server-job:old", "server-job:recent"]);
    });

    test("tombstones prevent recovery even when stale active records or jobs remain", async () => {
        const job = createJob("deleted", "image-a");
        const record = recoveryRecord(job);
        const index = await loadImageHistoryRecoveryIndex<History>("user-a", [job], undefined, async () => ({
            items: [{ id: record.id, deletedAt: 50 }],
            recoveryJobIds: [job.id],
        }));
        expect(mergeServerJobsIntoImageHistory(index, [job], recoveryRecord)).toEqual([]);
        expect(mergeServerJobsIntoImageHistory([record, { id: record.id, deletedAt: 50 }], [job], recoveryRecord)).toEqual([]);
    });

    test("job identity reuses a record even when normalized prompts and timestamps differ", () => {
        const job = createJob("job-a", "image-a");
        const record = { ...recoveryRecord(job), id: "local-record", prompt: "normalized", createdAt: 900_000, images: [], serverJobIds: [job.id] };
        const recovered = mergeServerJobsIntoImageHistory([record], [job], recoveryRecord);
        expect(recovered[0].id).toBe(record.id);
        expect(recovered[0].images.map((image) => image.id)).toEqual(["image-a"]);
    });

    test("newly archived images on old records remain recoverable", () => {
        const job = createJob("old", "old-image");
        const record = { ...recoveryRecord(job), images: [{ id: "old-image", dataUrl: "https://temporary.invalid/image", persisted: false }] };
        const changed = mergeServerJobsIntoImageHistory([record], [job], recoveryRecord);
        expect(changed[0].images[0].dataUrl).toBe("/api/job-files/old/image.png");
        expect(mergeServerJobsIntoImageHistory(changed, [job], recoveryRecord)).toEqual(changed);
    });

    test("failed persistence is retried from fresh remote state without a success cache", async () => {
        const job = createJob("missing", "image-a");
        for (let attempt = 0; attempt < 2; attempt++) {
            const index = await loadImageHistoryRecoveryIndex<History>("user-a", [job], undefined, async () => ({ items: [], recoveryJobIds: [job.id] }));
            expect(mergeServerJobsIntoImageHistory(index, [job], recoveryRecord)).toHaveLength(1);
        }
    });

    test("users never share an index or suppress each other's recovery", async () => {
        const job = createJob("same-id", "image-a");
        const record = recoveryRecord(job);
        const first = await loadImageHistoryRecoveryIndex<History>("user-a", [job], undefined, async () => ({ items: [record], recoveryJobIds: [job.id] }));
        const second = await loadImageHistoryRecoveryIndex<History>("user-b", [job], undefined, async (_kind, user) => {
            expect(user).toBe("user-b");
            return { items: [{ ...record, ownerUserId: "user-a" }], recoveryJobIds: [job.id] };
        });
        expect(first).toHaveLength(1);
        expect(second).toEqual([]);
        expect(mergeServerJobsIntoImageHistory(second, [job], recoveryRecord)).toEqual([record]);
    });

    test("a superseded request stops before reading more batches", async () => {
        let current = true;
        let calls = 0;
        const index = await loadImageHistoryRecoveryIndex<History>(
            "user-a",
            Array.from({ length: 60 }, (_, i) => createJob(String(i), String(i))),
            () => current,
            async () => {
                calls++;
                current = false;
                return { items: [recoveryRecord(createJob("a", "a"))], hasMore: true };
            },
        );
        expect(index).toEqual([]);
        expect(calls).toBe(1);
    });

    test("batch errors and unsupported servers never become missing-history recovery", async () => {
        const jobs = Array.from({ length: 60 }, (_, i) => createJob(String(i), String(i)));
        await expect(
            loadImageHistoryRecoveryIndex<History>("user-a", jobs, undefined, async (_kind, _user, query) => {
                if (query?.recoveryJobIds?.[0] === "50") throw new Error("offline");
                return { items: [], recoveryJobIds: query?.recoveryJobIds };
            }),
        ).rejects.toThrow("offline");
        await expect(loadImageHistoryRecoveryIndex<History>("user-a", jobs, undefined, async () => ({ items: [], hasMore: true }))).rejects.toThrow("查询不完整");
        await expect(loadImageHistoryRecoveryIndex<History>("user-a", jobs, undefined, async () => ({ items: [], hasMore: false }))).rejects.toThrow("查询不完整");
    });

    test("200 jobs require at most four requests and 200 records, independent of history size", async () => {
        const jobs = Array.from({ length: 200 }, (_, i) => createJob(String(i), String(i)));
        let calls = 0;
        const index = await loadImageHistoryRecoveryIndex<History>("user-a", jobs, undefined, async (_kind, _user, query) => {
            calls++;
            expect(query?.recoveryJobIds).toHaveLength(50);
            return { items: query!.recoveryJobIds!.map((id) => recoveryRecord(jobs[Number(id)])), recoveryJobIds: query?.recoveryJobIds };
        });
        expect(index).toHaveLength(200);
        expect(calls).toBe(4);
        await expect(loadImageHistoryRecoveryIndex("user-a", [...jobs, createJob("overflow", "overflow")])).rejects.toThrow("超过上限");
    });

    test("no terminal image jobs require no history request", async () => {
        let calls = 0;
        const index = await loadImageHistoryRecoveryIndex(
            "user-a",
            [
                { ...createJob("a", "a"), status: "running" },
                { ...createJob("b", "b"), source: { route: "/canvas" } },
            ],
            undefined,
            async () => {
                calls++;
                return { items: [] };
            },
        );
        expect(index).toEqual([]);
        expect(calls).toBe(0);
    });
});

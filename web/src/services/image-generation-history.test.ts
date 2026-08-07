import { describe, expect, test } from "bun:test";

import { mergePersistedImagesIntoHistoryRecord, mergeServerJobsIntoImageHistory, serverJobModelValue } from "./image-generation-history";
import type { ServerJob } from "./server-api";

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

        const logs: History[] = [{ id: "local", createdAt: 10, prompt: "A", model: "sadai::gpt-image-2", images: [] }];
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

        const merged = mergePersistedImagesIntoHistoryRecord(
            record,
            [{ id: "image-a", dataUrl: "/api/job-files/job-a/result.png", persisted: true }],
            "job-a",
            20,
        );

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

        expect(
            mergePersistedImagesIntoHistoryRecord(record, [{ id: "image-a", dataUrl: "/api/job-files/job-a/result.png", persisted: true }], "job-a"),
        ).toBe(record);
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

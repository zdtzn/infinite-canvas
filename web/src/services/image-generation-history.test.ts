import { describe, expect, test } from "bun:test";

import { mergeServerJobsIntoImageHistory, serverJobModelValue } from "./image-generation-history";
import type { ServerJob } from "./server-api";

type History = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    prompt: string;
    model: string;
    images: Array<{ id: string }>;
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

import { expect, test } from "bun:test";
import { completedServerImages } from "./image";
import type { ServerJob } from "@/services/server-api";

const job: ServerJob = {
    id: "job",
    status: "succeeded",
    createdAt: 0,
    prompt: "paid",
    model: "test",
    count: 1,
    result: { images: [{ id: "one", dataUrl: "/api/job-files/job/one.png", recoveryUrl: "https://temporary/image", persisted: false, bytes: 10, durationMs: 1, mimeType: "image/png" }], successCount: 1, failCount: 0, durationMs: 1, recoveryPending: true },
};

test("canvas gets temporary image immediately and archival callback later", async () => {
    const pending = Promise.withResolvers<ServerJob>();
    let callback: ServerJob | undefined;
    const images = completedServerImages(
        job,
        "owner",
        {
            source: { route: "/canvas/project" },
            onJobArchived: (value) => {
                callback = value;
            },
        },
        () => pending.promise,
    );
    expect(images[0].dataUrl).toBe("https://temporary/image");
    expect(images[0].jobId).toBe("job");
    expect(images[0].expectedUserId).toBe("owner");
    expect(callback).toBeUndefined();
    const archived = { ...job, result: { ...job.result!, images: [{ ...job.result!.images[0], persisted: true }] } };
    pending.resolve(archived);
    expect(await images[0].archiveResult).toEqual({ job: archived });
    await Promise.resolve();
    expect(callback).toBe(archived);
});

test("archive rejection preserves generation and reports save failure", async () => {
    const failure = new Error("save offline");
    let reported: unknown;
    let archives = 0;
    const images = completedServerImages(
        job,
        "owner",
        {
            onJobArchiveFailed: (error) => {
                reported = error;
            },
        },
        async () => {
            archives++;
            throw failure;
        },
    );
    expect(images[0].persisted).toBe(false);
    expect(await images[0].archiveResult).toEqual({ error: failure });
    await Promise.resolve();
    expect(reported).toBe(failure);
    expect(archives).toBe(1);
    expect(images[0].dataUrl).toBe("https://temporary/image");
});

test("persisted images do not rearchive; consumer callback failure is isolated", async () => {
    const archived = { ...job, result: { ...job.result!, images: [{ ...job.result!.images[0], persisted: true }] } };
    const images = completedServerImages(archived, "owner", undefined, async () => {
        throw new Error("must not archive");
    });
    expect(await images[0].archiveResult).toEqual({ job: archived });
    const temporary = completedServerImages(
        job,
        "owner",
        {
            onJobArchived: () => {
                throw new Error("consumer failed");
            },
        },
        async () => archived,
    );
    expect(await temporary[0].archiveResult).toEqual({ job: archived });
});

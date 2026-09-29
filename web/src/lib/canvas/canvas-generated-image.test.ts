import { expect, test } from "bun:test";
import { applyCanvasImageSaveResult, canvasImageMetadata, canvasImageResourceMetadata, createCanvasImageSaver, imageSaveState, type CanvasImageSave } from "./canvas-generated-image";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ServerJob } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";

const job: ServerJob = {
    id: "job",
    status: "succeeded",
    createdAt: 0,
    prompt: "paid",
    model: "test",
    count: 1,
    result: { images: [{ id: "one", dataUrl: "/api/job-files/job/one.png", persisted: true, bytes: 10, durationMs: 1, mimeType: "image/png" }], successCount: 1, failCount: 0, durationMs: 1 },
};
const uploaded = { url: "/api/job-files/job/one.png", storageKey: "image:durable", width: 40, height: 20, bytes: 10, mimeType: "image/png" };

test("temporary first display does not upload recovery URL and shares one durable promotion", async () => {
    const pending = Promise.withResolvers<{ job: ServerJob }>();
    let uploads = 0;
    const saver = createCanvasImageSaver(
        {
            upload: async (url, options) => {
                expect(url).toBe(job.result!.images[0].dataUrl);
                expect(options?.createThumbnail).toBe(false);
                expect(options?.expectedUserId).toBe("owner");
                uploads++;
                return uploaded;
            },
            fetch: async () => {
                throw new Error("no duplicate read");
            },
            archive: async () => {
                throw new Error("no duplicate archive");
            },
        },
        () => "owner",
    );
    const preview = await saver.prepare({ id: "one", jobId: "job", expectedUserId: "owner", dataUrl: "https://temporary/image", persisted: false, archiveResult: pending.promise, width: 40, height: 20 });
    expect(preview.url).toBe("https://temporary/image");
    expect(uploads).toBe(0);
    const save = imageSaveState(canvasImageMetadata(preview))!;
    expect(save.state).toBe("pending");
    const first = saver.save(save);
    expect(saver.save(save)).toBe(first);
    pending.resolve({ job });
    const durable = await first;
    expect(uploads).toBe(1);
    expect(durable.url).toBe(PUBLIC_MODE ? "/api/assets/image%3Adurable" : uploaded.url);
    expect(imageSaveState(canvasImageMetadata(durable))).toBeUndefined();
});

test("failed archival retains preview and retry/reload only saves the original job", async () => {
    let fetches = 0;
    let archives = 0;
    let uploads = 0;
    const saver = createCanvasImageSaver(
        {
            upload: async () => {
                uploads++;
                return uploaded;
            },
            fetch: async (id, owner) => {
                expect(id).toBe("job");
                expect(owner).toBe("owner");
                fetches++;
                return { job };
            },
            archive: async (value) => {
                archives++;
                return value;
            },
        },
        () => "owner",
    );
    const preview = await saver.prepare({ id: "one", jobId: "job", expectedUserId: "owner", dataUrl: "https://temporary/image", persisted: false, archiveResult: Promise.resolve({ error: new Error("offline") }) });
    const save = imageSaveState(canvasImageMetadata(preview))!;
    await expect(saver.save(save)).rejects.toThrow("offline");
    expect(uploads).toBe(0);
    expect(preview.url).toBe("https://temporary/image");
    saver.forget(save);
    await saver.save(JSON.parse(JSON.stringify(save)));
    expect([fetches, archives, uploads]).toEqual([1, 1, 1]);
});

test("promotion failure is retryable without downloading temporary image", async () => {
    const saver = createCanvasImageSaver({
        upload: async () => {
            throw new Error("quota");
        },
        fetch: async () => ({ job }),
        archive: async (value) => value,
    });
    const preview = await saver.prepare({ id: "one", jobId: "job", dataUrl: job.result!.images[0].dataUrl, archiveResult: Promise.resolve({ job }) });
    await expect(saver.save(imageSaveState(canvasImageMetadata(preview))!)).rejects.toThrow("quota");
    expect(preview.url).toBe(job.result!.images[0].dataUrl);
});

test("direct provider results retain the existing upload flow", async () => {
    let uploads = 0;
    const saver = createCanvasImageSaver({
        upload: async () => {
            uploads++;
            return uploaded;
        },
        fetch: async () => {
            throw new Error("not a server job");
        },
        archive: async (value) => value,
    });
    expect(await saver.prepare({ id: "direct", dataUrl: "data:image/png;base64,data" })).toBe(uploaded);
    expect(uploads).toBe(1);
});

test("switching a batch cover replaces all resource and save identity fields", () => {
    const save: CanvasImageSave = { jobId: "new-job", imageId: "new-image", userId: "owner", state: "pending" };
    const pending = canvasImageMetadata({ ...uploaded, url: "https://new-temporary", storageKey: "", imageSave: save });
    const cover = { ...canvasImageMetadata(uploaded), ...canvasImageResourceMetadata(pending) };
    expect(cover.content).toBe("https://new-temporary");
    expect(cover.storageKey).toBe("");
    expect(imageSaveState(cover)).toBe(save);
    const durableCover = { ...cover, ...canvasImageResourceMetadata(canvasImageMetadata(uploaded)) };
    expect(durableCover.storageKey).toBe("image:durable");
    expect(imageSaveState(durableCover)).toBeUndefined();
});

test("late success and failure cannot resurrect deleted nodes or overwrite a newer image", () => {
    const save: CanvasImageSave = { jobId: "job", imageId: "one", userId: "owner", state: "pending" };
    const newer: CanvasNodeData[] = [{ id: "node", type: CanvasNodeType.Image, title: "", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: canvasImageMetadata({ ...uploaded, imageSave: { ...save, imageId: "replacement" } }) }];
    const deleted: CanvasNodeData[] = [];
    for (const result of [{ uploaded }, { error: "late failure" }]) {
        expect(applyCanvasImageSaveResult(deleted, save, result, () => true)).toBe(deleted);
        expect(applyCanvasImageSaveResult(newer, save, result, () => true)).toBe(newer);
    }
});

test("session is checked when the queued update executes, including failures", () => {
    const save: CanvasImageSave = { jobId: "job", imageId: "one", userId: "owner", state: "pending" };
    const nodes: CanvasNodeData[] = [{ id: "node", type: CanvasNodeType.Image, title: "", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: canvasImageMetadata({ ...uploaded, url: "temporary", imageSave: save }) }];
    let active = true;
    for (const result of [{ uploaded }, { error: "late failure" }]) {
        const queued = () => applyCanvasImageSaveResult(nodes, save, result, () => active);
        active = false; // deletion of the project, navigation, unmount, or account change
        expect(queued()).toBe(nodes);
        active = true;
    }
    const completed = applyCanvasImageSaveResult(nodes, save, { uploaded }, () => true);
    expect(completed[0].metadata?.content).toBe(uploaded.url);
    expect(imageSaveState(completed[0].metadata)).toBeUndefined();
    const failed = applyCanvasImageSaveResult(nodes, save, { error: "offline" }, () => true);
    expect(failed[0].metadata?.content).toBe("temporary");
    expect(imageSaveState(failed[0].metadata)?.state).toBe("failed");
});

test("account switch while archiving stops promotion into the new session", async () => {
    const pending = Promise.withResolvers<{ job: ServerJob }>();
    let owner = "owner";
    let uploads = 0;
    const saver = createCanvasImageSaver(
        {
            upload: async () => {
                uploads++;
                return uploaded;
            },
            fetch: async () => ({ job }),
            archive: async (value) => value,
        },
        () => owner,
    );
    const preview = await saver.prepare({ id: "one", jobId: "job", expectedUserId: "owner", dataUrl: "temporary", archiveResult: pending.promise });
    const running = saver.save(imageSaveState(canvasImageMetadata(preview))!);
    owner = "other";
    pending.resolve({ job });
    await expect(running).rejects.toThrow("Account changed");
    expect(uploads).toBe(0);
});

test("unattached persisted previews do not promote; deleting a saving node releases its run", async () => {
    let uploads = 0;
    const pending = Promise.withResolvers<{ job: ServerJob }>();
    const saver = createCanvasImageSaver({
        upload: async () => {
            uploads++;
            return uploaded;
        },
        fetch: async () => ({ job }),
        archive: async (value) => value,
    });
    const unattached = await saver.prepare({ id: "one", jobId: "job", dataUrl: "job-file", persisted: true, archiveResult: Promise.resolve({ job }) });
    await Promise.resolve();
    expect(uploads).toBe(0);
    expect(imageSaveState(canvasImageMetadata(unattached))?.state).toBe("pending");
    const preview = await saver.prepare({ id: "one", jobId: "job", dataUrl: "temporary", archiveResult: pending.promise });
    const save = imageSaveState(canvasImageMetadata(preview))!;
    const running = saver.save(save);
    saver.retain([]); // node deleted before the archive completed
    pending.resolve({ job });
    await expect(running).rejects.toThrow("Save no longer attached");
    expect(uploads).toBe(0);
    const retry = saver.save(save);
    expect(retry).not.toBe(running);
    await retry;
    expect(uploads).toBe(1);
    saver.retain([save]);
    expect(saver.save(save)).toBe(retry); // completed callback can survive a rerender
    saver.dispose();
    expect(saver.save(save)).not.toBe(retry); // unmount cleared the cache
});

import { expect, test } from "bun:test";
import { completedServerImages } from "./api/image";
import { archiveDeferredServerJob, type ServerJob } from "./server-api";
import { useUserStore } from "@/stores/use-user-store";

function temporaryJob(id: string): ServerJob {
    return {
        id, status: "succeeded", createdAt: 0, prompt: "fixture", model: "gpt-image-2.5-flare", count: 1,
        result: {
            images: [{ id: "image", dataUrl: "https://images.example.com/result.png", persisted: false, bytes: 0, durationMs: 50_000, mimeType: "image/png" }],
            successCount: 1, failCount: 0, durationMs: 50_000, recoveryPending: true,
        },
    };
}

function savedJob(job: ServerJob): ServerJob {
    return { ...job, result: { ...job.result!, recoveryPending: false, images: job.result!.images.map((image) => ({ ...image, persisted: true, dataUrl: `/api/job-files/${job.id}/${image.id}.png`, bytes: 42 })) } };
}

async function withTransport(run: (delays: number[], timeouts: number[]) => Promise<void>) {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    const previousUser = useUserStore.getState().user;
    const delays: number[] = [];
    const timeouts: number[] = [];
    globalThis.window = {
        setTimeout: (fn: TimerHandler, ms?: number) => {
            if (ms !== undefined) timeouts.push(ms);
            if (ms === 1_200 || ms === 3_000) {
                delays.push(ms);
                return setTimeout(fn as () => void, 1);
            }
            return setTimeout(fn as () => void, ms);
        },
        clearTimeout, dispatchEvent: () => true,
    } as unknown as Window & typeof globalThis;
    useUserStore.setState({ user: { id: "owner", username: "owner", displayName: "owner", avatarUrl: "" } });
    try {
        await run(delays, timeouts);
    } finally {
        globalThis.fetch = previousFetch;
        globalThis.window = previousWindow;
        useUserStore.setState({ user: previousUser });
    }
}

test("nonrelay recovery allows 75 seconds to save the existing image without submitting generation", () => withTransport(async (_delays, timeouts) => {
    const job = temporaryJob("recover-existing");
    const permanent = savedJob(job);
    const requests: string[] = [];
    globalThis.fetch = (async (url, init) => {
        requests.push(`${init?.method || "GET"} ${url}`);
        expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe("owner");
        expect(init?.credentials).toBe("same-origin");
        return Response.json({ job: permanent, recovered: 1, recoveryPending: false });
    }) as typeof fetch;
    const result = await archiveDeferredServerJob(job, "owner");
    expect(result).toEqual(permanent);
    expect(result.result!.images[0].id).toBe(job.result!.images[0].id);
    expect(requests).toEqual(["POST /api/jobs/recover-existing/recover"]);
    expect(timeouts).toEqual([75_000]);
    expect(job.result!.images[0].persisted).toBe(false);
}));

test("202 stays pending until the original image is actually saved", () => withTransport(async (delays) => {
    const job = temporaryJob("recover-pending");
    const permanent = savedJob(job);
    const secondRequest = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<Response>();
    const requests: string[] = [];
    let recoveries = 0;
    let callbacks = 0;
    globalThis.fetch = (async (url, init) => {
        const method = init?.method || "GET";
        requests.push(`${method} ${url}`);
        if (method === "GET") return Response.json({ job });
        if (++recoveries === 1) return Response.json({ job, recoveryPending: true }, { status: 202 });
        secondRequest.resolve();
        return saved.promise;
    }) as typeof fetch;
    const images = completedServerImages(job, "owner", { onJobArchived: () => callbacks++ });
    expect(images[0].dataUrl).toBe(job.result!.images[0].dataUrl);
    expect(recoveries).toBe(0);
    await secondRequest.promise;
    expect(callbacks).toBe(0);
    saved.resolve(Response.json({ job: permanent, recoveryPending: false }));
    expect(await images[0].archiveResult).toEqual({ job: permanent });
    await Promise.resolve();
    expect(callbacks).toBe(1);
    expect(delays).toEqual([1_200]);
    expect(requests).toEqual(["POST /api/jobs/recover-pending/recover", "GET /api/jobs/recover-pending", "POST /api/jobs/recover-pending/recover"]);
}));

test("persistent recovery failure preserves the successful temporary result", () => withTransport(async (delays) => {
    const job = temporaryJob("recover-failed");
    const requests: string[] = [];
    let archived = 0;
    let failed = 0;
    globalThis.fetch = (async (url, init) => {
        requests.push(`${init?.method || "GET"} ${url}`);
        return Response.json({ job, recoveryPending: true }, { status: init?.method === "POST" ? 202 : 200 });
    }) as typeof fetch;
    const images = completedServerImages(job, "owner", { onJobArchived: () => archived++, onJobArchiveFailed: () => failed++ });
    const result = await images[0].archiveResult;
    expect(result).toHaveProperty("error");
    await Promise.resolve();
    expect(archived).toBe(0);
    expect(failed).toBe(1);
    expect(images[0].persisted).toBe(false);
    expect(images[0].dataUrl).toBe(job.result!.images[0].dataUrl);
    expect(job.status).toBe("succeeded");
    expect(job.result!.successCount).toBe(1);
    expect(delays).toEqual([1_200, 3_000]);
    expect(requests.filter((request) => request.startsWith("POST"))).toEqual(Array(3).fill("POST /api/jobs/recover-failed/recover"));
    expect(requests.filter((request) => request.startsWith("GET"))).toHaveLength(2);
}));

test("a saved result is reconciled after a transport failure without another save POST", () => withTransport(async () => {
    const job = temporaryJob("recover-read");
    const permanent = savedJob(job);
    const requests: string[] = [];
    globalThis.fetch = (async (url, init) => {
        requests.push(`${init?.method || "GET"} ${url}`);
        if (init?.method === "POST") throw new TypeError("offline");
        return Response.json({ job: permanent });
    }) as typeof fetch;
    expect(await archiveDeferredServerJob(job, "owner")).toEqual(permanent);
    expect(requests).toEqual(["POST /api/jobs/recover-read/recover", "GET /api/jobs/recover-read"]);
}));

test("concurrent consumers share recovery while cancellation only ends that consumer", () => withTransport(async () => {
    const job = temporaryJob("recover-shared");
    const permanent = savedJob(job);
    const response = Promise.withResolvers<Response>();
    const controller = new AbortController();
    let requests = 0;
    globalThis.fetch = (async (_url, init) => {
        requests++;
        expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe("owner");
        expect(init?.signal?.aborted).toBe(false);
        return response.promise;
    }) as typeof fetch;
    const canceled = archiveDeferredServerJob(job, "owner", controller.signal);
    const continuing = archiveDeferredServerJob(job, "owner");
    const rejection = canceled.catch((error: unknown) => error);
    controller.abort();
    expect(await rejection).toMatchObject({ name: "AbortError" });
    response.resolve(Response.json({ job: permanent }));
    expect(await continuing).toEqual(permanent);
    expect(requests).toBe(1);
}));

test("recovery coalescing is scoped to the captured account and drops old-account responses", () => withTransport(async () => {
    const job = temporaryJob("recover-owners");
    const responseA = Promise.withResolvers<Response>();
    const responseB = Promise.withResolvers<Response>();
    const owners: string[] = [];
    globalThis.fetch = (async (_url, init) => {
        const owner = new Headers(init?.headers).get("X-Expected-User-Id")!;
        owners.push(owner);
        return owner === "owner-a" ? responseA.promise : responseB.promise;
    }) as typeof fetch;
    useUserStore.setState({ user: { id: "owner-a" } as NonNullable<ReturnType<typeof useUserStore.getState>["user"]> });
    const first = archiveDeferredServerJob(job);
    const firstRejection = first.catch((error: unknown) => error);
    useUserStore.setState({ user: { id: "owner-b" } as NonNullable<ReturnType<typeof useUserStore.getState>["user"]> });
    const second = archiveDeferredServerJob(job);
    responseA.resolve(Response.json({ job: savedJob(job) }));
    responseB.resolve(Response.json({ job: savedJob(job) }));
    expect(await firstRejection).toMatchObject({ name: "AbortError" });
    expect(await second).toEqual(savedJob(job));
    expect(owners).toEqual(["owner-a", "owner-b"]);
}));

test("a stale account cannot start or join recovery", () => withTransport(async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return Response.json({}); }) as typeof fetch;
    await expect(archiveDeferredServerJob(temporaryJob("recover-stale-owner"), "old-owner")).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(0);
}));

test("pre-canceled recovery never starts a save request", () => withTransport(async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return Response.json({}); }) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(archiveDeferredServerJob(temporaryJob("recover-canceled"), "owner", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(0);
}));

test("existing relay results still download in the browser and upload for archival", () => withTransport(async () => {
    const job = temporaryJob("recover-relay");
    job.result!.images[0].recoveryUrl = "https://relay.example.com/image";
    const permanent = savedJob(job);
    const requests: string[] = [];
    globalThis.fetch = (async (url, init) => {
        requests.push(`${init?.method || "GET"} ${url}`);
        if (url === job.result!.images[0].recoveryUrl) {
            expect(init?.credentials).toBe("omit");
            return new Response(new Blob(["image"], { type: "image/png" }));
        }
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init!.body as FormData).get("imageId")).toBe("image");
        expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe("owner");
        return Response.json({ job: permanent, image: permanent.result!.images[0], archived: true });
    }) as typeof fetch;
    expect(await archiveDeferredServerJob(job, "owner")).toEqual(permanent);
    expect(requests).toEqual(["GET https://relay.example.com/image", "POST /api/jobs/recover-relay/archive"]);
}));

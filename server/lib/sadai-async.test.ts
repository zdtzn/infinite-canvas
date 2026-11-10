import { expect, test } from "bun:test";
import { submitSadaiAsyncTask, waitForSadaiAsyncTask } from "./sadai-async";

const base = "https://api.sadai.top/v1";
const okResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

for (const referenceCount of [1, 3]) {
    test(`submits ${referenceCount} reference images to the SADAI edit-task endpoint in order`, async () => {
        const images = Array.from({ length: referenceCount }, (_, index) => `data:image/png;base64,fixture-${index}`);
        const result = await submitSadaiAsyncTask(base, "key", { model: "gpt-image-2.6-flare", prompt: "edit fixture", images }, new AbortController().signal, async (url, init) => {
            expect(String(url)).toBe(`${base}/images/edit-tasks`);
            expect(init?.method).toBe("POST");
            expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
            expect(JSON.parse(String(init?.body)).images).toEqual(images);
            return okResponse({ id: "edit-task", status: "QUEUED" });
        });
        expect(result).toBe("edit-task");
    });
}

test("submits text-only and empty-reference requests to the SADAI generation-task endpoint", async () => {
    for (const references of [undefined, []]) {
        await submitSadaiAsyncTask(base, "key", { model: "gpt-image-2.6-flare", prompt: "fixture", ...(references ? { images: references } : {}) }, new AbortController().signal, async (url) => {
            expect(String(url)).toBe(`${base}/images/tasks`);
            return okResponse({ id: "generation-task" });
        });
    }
});

test("submits a SADAI async task and returns the task id", async () => {
    const bodies: unknown[] = [];
    const result = await submitSadaiAsyncTask(base, "key", { model: "gpt-image-2.6-flare", prompt: "cat", images: ["data:image/png;base64,AAAA"] }, new AbortController().signal, async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return okResponse({ id: "task_abc", status: "QUEUED" });
    });
    expect(result).toBe("task_abc");
    expect(bodies[0]).toMatchObject({ model: "gpt-image-2.6-flare", images: ["data:image/png;base64,AAAA"] });
});

test("surfaces submit errors from the gateway message", async () => {
    let calls = 0;
    await expect(submitSadaiAsyncTask(base, "key", {}, new AbortController().signal, async () => {
        calls += 1;
        return okResponse({ error: { message: "service temporarily busy" } }, 503);
    })).rejects.toThrow("service temporarily busy");
    expect(calls).toBe(1);
});

test("polls until SUCCESS and returns result urls through the url policy", async () => {
    let polls = 0;
    const result = await waitForSadaiAsyncTask(base, "key", "task_abc", new AbortController().signal, undefined, async (_url, init) => {
        polls += 1;
        if (polls === 1) return okResponse({ status: "QUEUED", progress: "0%" });
        if (polls === 2) return okResponse({ status: "IN_PROGRESS", progress: "40%" });
        return okResponse({
            status: "SUCCESS", progress: "100%",
            response: { data: [{ url: "https://api.sadai.top/api/image-result/task_abc/0/image_1.png?expires=1&signature=a", mime_type: "image/png" }] },
        });
    }, 1);
    expect(result.status).toBe("SUCCESS");
    expect(result.urls.length).toBe(1);
    expect(result.urls[0]).toContain("image-result");
    expect(polls).toBe(3);
});

test("fails fast on FAILED terminal status with the gateway message", async () => {
    await expect(waitForSadaiAsyncTask(base, "key", "task_bad", new AbortController().signal, undefined, async () =>
        okResponse({ status: "FAILED", error: { message: "内容被拦截" } }),
    )).rejects.toThrow("内容被拦截");
});

test("rejects unreachable result urls instead of passing them through", async () => {
    await expect(waitForSadaiAsyncTask(base, "key", "task_evil", new AbortController().signal, undefined, async () =>
        okResponse({ status: "SUCCESS", response: { data: [{ url: "http://169.254.169.254/latest/meta-data" }] } }),
    )).rejects.toThrow();
});

test("preserves submission HTTP status separately from the upstream message", async () => {
    await expect(submitSadaiAsyncTask(base, "key", {}, new AbortController().signal, async () =>
        okResponse({ error: { message: "Not Found" } }, 404),
    )).rejects.toMatchObject({ status: 404, stage: "submit", message: "Not Found" });
});

test("preserves an endpoint 404 even when its response is not JSON", async () => {
    await expect(submitSadaiAsyncTask(base, "key", {}, new AbortController().signal, async () =>
        new Response("404 page not found", { status: 404 }),
    )).rejects.toMatchObject({ status: 404, stage: "submit" });
});

test("retries transient polling failures against the same accepted task", async () => {
    const urls: string[] = [];
    const result = await waitForSadaiAsyncTask(base, "key", "accepted-task", new AbortController().signal, undefined, async (url) => {
        urls.push(String(url));
        if (urls.length === 1) return okResponse({ error: { message: "busy" } }, 503);
        if (urls.length === 2) throw new TypeError("connection reset");
        if (urls.length === 3) return okResponse({}, 404);
        return okResponse({ status: "SUCCESS", response: { data: [{ url: "https://images.example.com/result.png" }] } });
    }, 1);
    expect(result.urls).toEqual(["https://images.example.com/result.png"]);
    expect(urls).toEqual(Array(4).fill(`${base}/images/tasks/accepted-task`));
});

test("does not retry authentication failures while polling", async () => {
    let calls = 0;
    await expect(waitForSadaiAsyncTask(base, "key", "task", new AbortController().signal, undefined, async () => {
        calls++;
        return okResponse({ error: { message: "invalid credentials" } }, 401);
    }, 1)).rejects.toThrow("invalid credentials");
    expect(calls).toBe(1);
});

for (const stage of ["headers", "body"] as const) {
    test(`the total polling deadline aborts stalled ${stage}`, async () => {
        let aborted = false;
        const pending: typeof fetch = async (_url, init) => {
            const signal = init!.signal!;
            if (stage === "headers") return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
            });
            return new Response(new ReadableStream({ start(controller) {
                signal.addEventListener("abort", () => { aborted = true; controller.error(signal.reason); }, { once: true });
            } }));
        };
        await expect(waitForSadaiAsyncTask(base, "key", "task", new AbortController().signal, undefined, pending, 1,
            { maxWaitMs: 25, requestTimeoutMs: 1_000 })).rejects.toThrow("等待超时");
        expect(aborted).toBe(true);
    });
}

test("bounds submission without replaying a possibly accepted paid request", async () => {
    let calls = 0;
    await expect(submitSadaiAsyncTask(base, "key", {}, new AbortController().signal, async (_url, init) => {
        calls++;
        expect(new Headers(init!.headers).get("Idempotency-Key")).toBe("fixture-request");
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
    }, { requestTimeoutMs: 20, idempotencyKey: "fixture-request" })).rejects.toThrow();
    expect(calls).toBe(1);
});

test("persists provider terminal status before reporting its failure", async () => {
    const statuses: string[] = [];
    await expect(waitForSadaiAsyncTask(base, "key", "task", new AbortController().signal, undefined, async () =>
        okResponse({ status: "FAILED", error: { message: "rejected" } }),
    1, { onStatus: async (status) => { statuses.push(status); } })).rejects.toThrow("rejected");
    expect(statuses).toEqual(["failed"]);
});

test("limits consecutive polling failures while keeping the accepted task unchanged", async () => {
    let calls = 0;
    await expect(waitForSadaiAsyncTask(base, "key", "accepted-task", new AbortController().signal, undefined, async (url) => {
        expect(String(url)).toBe(`${base}/images/tasks/accepted-task`);
        calls++;
        return okResponse({ error: { message: "busy" } }, 503);
    }, 1)).rejects.toThrow("busy");
    expect(calls).toBe(5);
});

test("cancellation interrupts the polling delay without another request", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture canceled");
    let calls = 0;
    const result = waitForSadaiAsyncTask(base, "key", "task", controller.signal, () => {
        setTimeout(() => controller.abort(reason), 5);
    }, async () => { calls++; return okResponse({ status: "QUEUED" }); }, 1_000);
    await expect(result).rejects.toBe(reason);
    expect(calls).toBe(1);
});

test("an already canceled submit makes no upstream request", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture canceled before submit");
    controller.abort(reason);
    let calls = 0;
    await expect(submitSadaiAsyncTask(base, "key", {}, controller.signal, async () => { calls++; return okResponse({ id: "unexpected" }); })).rejects.toBe(reason);
    expect(calls).toBe(0);
});

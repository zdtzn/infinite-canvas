import { expect, test } from "bun:test";
import { submitSadaiAsyncTask, waitForSadaiAsyncTask } from "./sadai-async";

const base = "https://api.sadai.top/v1";
const okResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("submits a SADAI async task and returns the task id", async () => {
    const bodies: unknown[] = [];
    const result = await submitSadaiAsyncTask(base, "key", { model: "gpt-image-2.6-flare", prompt: "cat" }, new AbortController().signal, async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return okResponse({ id: "task_abc", status: "QUEUED" });
    });
    expect(result).toBe("task_abc");
    expect(bodies[0]).toMatchObject({ model: "gpt-image-2.6-flare" });
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

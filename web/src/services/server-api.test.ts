import assert from "node:assert/strict";
import { test } from "node:test";
import { serverRequest, ServerRequestError, ServerTransportError, waitForServerJob, type ServerJobProgress } from "./server-api";

async function withTransport(run: () => Promise<void>) {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    globalThis.window = {
        setTimeout: (fn: TimerHandler, ms?: number) => setTimeout(fn as () => void, [800, 1200, 1600, 1800].includes(ms || 0) ? 1 : ms),
        clearTimeout,
        dispatchEvent: () => true,
    } as unknown as Window & typeof globalThis;
    try {
        await run();
    } finally {
        globalThis.fetch = previousFetch;
        globalThis.window = previousWindow;
    }
}

test("server deadline includes response body, not just headers", () =>
    withTransport(async () => {
        globalThis.fetch = (async (_url, init) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        init!.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
                    },
                }),
            )) as typeof fetch;
        await assert.rejects(serverRequest("/body", { timeoutMs: 20, expectedUserId: "test-owner" }), (error: unknown) => error instanceof ServerTransportError && /超时/.test(error.message));
    }));

test("job polling survives network and temporary server errors without resubmitting", () =>
    withTransport(async () => {
        const requests: Array<{ url: string; method: string }> = [];
        globalThis.fetch = (async (url, init) => {
            requests.push({ url: String(url), method: init?.method || "GET" });
            assert.equal(new Headers(init?.headers).get("X-Expected-User-Id"), "owner");
            if (requests.length === 1) throw new TypeError("Failed to fetch");
            if (requests.length === 2) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
            return Response.json({ job: { id: "original-job", status: "succeeded" } });
        }) as typeof fetch;
        const progress: ServerJobProgress[] = [];
        const result = await waitForServerJob("original-job", { expectedUserId: "owner", onProgress: (value) => progress.push(value) });
        assert.deepEqual(progress, [
            { jobId: "original-job", phase: undefined, reconnecting: true },
            { jobId: "original-job", phase: "completed", reconnecting: false },
        ]);
        assert.equal(result.id, "original-job");
        assert.deepEqual(
            requests,
            Array.from({ length: 3 }, () => ({ url: "/api/jobs/original-job", method: "GET" })),
        );
    }));

test("job polling does not retry authentication, permission, or missing-job errors", () =>
    withTransport(async () => {
        for (const status of [401, 403, 404]) {
            let calls = 0;
            globalThis.fetch = (async () => {
                calls++;
                return Response.json({ error: "denied" }, { status });
            }) as typeof fetch;
            await assert.rejects(waitForServerJob("missing", { expectedUserId: "owner" }), (error: unknown) => error instanceof ServerRequestError && error.status === status);
            assert.equal(calls, 1);
        }
    }));

test("progress reports only phase and connection changes, preserving the original job", () =>
    withTransport(async () => {
        const phases = ["queued", "queued", "submitting", "waiting_upstream", "offline", "offline", "waiting_upstream", "waiting_upstream", "persisting", "completed"];
        const progress: ServerJobProgress[] = [];
        let calls = 0;
        globalThis.fetch = (async (url, init) => {
            assert.equal(String(url), "/api/jobs/same-job");
            assert.equal(init?.method || "GET", "GET");
            const phase = phases[calls++];
            if (phase === "offline") throw new TypeError("offline");
            return Response.json({ job: { id: "same-job", phase, status: phase === "completed" ? "succeeded" : phase === "queued" ? "queued" : "running" } });
        }) as typeof fetch;
        await waitForServerJob("same-job", { onProgress: (value) => progress.push(value) });
        assert.equal(calls, phases.length);
        assert.deepEqual(progress.map(({ phase, reconnecting }) => [phase, reconnecting]), [
            ["queued", false], ["submitting", false], ["waiting_upstream", false],
            ["waiting_upstream", true], ["waiting_upstream", false], ["persisting", false], ["completed", false],
        ]);
        const next: ServerJobProgress[] = [];
        globalThis.fetch = (async () => Response.json({ job: { id: "next-job", status: "succeeded" } })) as typeof fetch;
        await waitForServerJob("next-job", { onProgress: (value) => next.push(value) });
        assert.deepEqual(next, [{ jobId: "next-job", phase: "completed", reconnecting: false }]);
    }));

test("an aborted response cannot emit a late progress update", () =>
    withTransport(async () => {
        const controller = new AbortController();
        const progress: ServerJobProgress[] = [];
        globalThis.fetch = (async () => {
            controller.abort();
            return Response.json({ job: { id: "late", status: "succeeded", phase: "completed" } });
        }) as typeof fetch;
        await assert.rejects(waitForServerJob("late", { signal: controller.signal, onProgress: (value) => progress.push(value) }), { name: "AbortError" });
        assert.deepEqual(progress, []);
    }));

test("cancel interrupts an in-flight polling read immediately", () =>
    withTransport(async () => {
        const controller = new AbortController();
        globalThis.fetch = ((_url, init) =>
            new Promise((_resolve, reject) => {
                init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
                queueMicrotask(() => controller.abort());
            })) as typeof fetch;
        await assert.rejects(waitForServerJob("cancel-me", { expectedUserId: "owner", signal: controller.signal }), { name: "AbortError" });
    }));

test("cancel interrupts retry backoff and does not issue another request", () =>
    withTransport(async () => {
        const controller = new AbortController();
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            setTimeout(() => controller.abort(), 0);
            throw new TypeError("offline");
        }) as typeof fetch;
        await assert.rejects(waitForServerJob("cancel-me", { expectedUserId: "owner", signal: controller.signal }), { name: "AbortError" });
        assert.equal(calls, 1);
    }));

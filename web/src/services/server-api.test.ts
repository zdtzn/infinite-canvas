import assert from "node:assert/strict";
import { test } from "node:test";
import { serverRequest, ServerRequestError, ServerTransportError, waitForServerJob } from "./server-api";

async function withTransport(run: () => Promise<void>) {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    globalThis.window = {
        setTimeout: (fn: TimerHandler, ms?: number) => setTimeout(fn as () => void, ms === 800 || ms === 1600 ? 1 : ms),
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
        const result = await waitForServerJob("original-job", { expectedUserId: "owner" });
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

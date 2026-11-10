import { assertAllowedUpstreamUrl } from "./url-policy";
import type { ImageJobInput } from "../types";

const SADAI_TASK_POLL_INTERVAL_MS = 2_500;
const SADAI_TASK_MAX_WAIT_MS = 15 * 60_000;
const SADAI_TASK_REQUEST_TIMEOUT_MS = 30_000;
const SADAI_TASK_TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "CANCELED", "CANCELLED"]);

export type SadaiAsyncTaskResult = { urls: string[]; status: string };
type TaskStatus = NonNullable<ImageJobInput["upstream"]>["status"];

export class SadaiTaskHttpError extends Error {
    constructor(public status: number, public stage: "submit" | "poll", message: string) {
        super(message);
    }
}

export function hasSadaiAsyncTask(input: ImageJobInput): input is ImageJobInput & {
    upstream: NonNullable<ImageJobInput["upstream"]> & { provider: "sadai-image" };
} {
    return input.upstream?.provider === "sadai-image" && Boolean(input.upstream.taskId);
}

/** 提交一个 SADAI 异步生图任务，返回任务编号。提交失败会抛出，由调用方决定是否降级。 */
export async function submitSadaiAsyncTask(
    endpointBase: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    fetchImpl: typeof fetch = fetch,
    options: { requestTimeoutMs?: number; idempotencyKey?: string } = {},
): Promise<string> {
    // A timeout may occur after acceptance: never automatically replay this POST.
    // SADAI documents separate generation and edit submissions; /tasks ignores reference images.
    const path = Array.isArray(body.images) && body.images.length ? "/images/edit-tasks" : "/images/tasks";
    const payload = await requestJson(`${endpointBase}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
            ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
        body: JSON.stringify(body),
    }, signal, options.requestTimeoutMs ?? SADAI_TASK_REQUEST_TIMEOUT_MS, fetchImpl, "submit");
    const id = String(payload?.id || payload?.task_id || "");
    if (!id) {
        const message = String(payload?.error?.message || payload?.message || "").slice(0, 200);
        throw new Error(message || "SADAI 异步任务提交后未返回任务编号，请先确认结果再重试");
    }
    return id;
}

/** 轮询 SADAI 异步任务直至终态，返回结果里的图片地址。 */
export async function waitForSadaiAsyncTask(
    endpointBase: string,
    apiKey: string,
    taskId: string,
    signal: AbortSignal,
    onQueued?: () => void,
    fetchImpl: typeof fetch = fetch,
    pollIntervalMs = SADAI_TASK_POLL_INTERVAL_MS,
    options: { maxWaitMs?: number; requestTimeoutMs?: number; onStatus?: (status: TaskStatus) => void | Promise<void> } = {},
): Promise<SadaiAsyncTaskResult> {
    const deadline = Date.now() + (options.maxWaitMs ?? SADAI_TASK_MAX_WAIT_MS);
    let failures = 0;
    for (;;) {
        if (signal.aborted) throw abortError(signal);
        if (Date.now() >= deadline) throw new Error("SADAI 异步任务等待超时，可稍后找回原任务");
        let payload: Record<string, any>;
        try {
            payload = await requestJson(`${endpointBase}/images/tasks/${encodeURIComponent(taskId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            }, signal, Math.min(options.requestTimeoutMs ?? SADAI_TASK_REQUEST_TIMEOUT_MS, deadline - Date.now()), fetchImpl, "poll");
        } catch (error) {
            if (signal.aborted) throw abortError(signal);
            if (Date.now() >= deadline) throw new Error("SADAI 异步任务等待超时，可稍后找回原任务");
            if (error instanceof SadaiTaskHttpError && error.status < 500 && ![404, 408, 429].includes(error.status)) throw error;
            if (++failures >= 5) throw error;
            await sleep(Math.min(pollIntervalMs, deadline - Date.now()), signal);
            continue;
        }
        failures = 0;
        const status = String(payload?.status || "").toUpperCase();
        const normalized: TaskStatus = status === "SUCCESS" ? "succeeded" : status === "FAILED" ? "failed" :
            ["CANCELED", "CANCELLED"].includes(status) ? "canceled" : status === "QUEUED" ? "pending" : status === "IN_PROGRESS" ? "running" : "unknown";
        if (normalized !== "unknown") await options.onStatus?.(normalized);
        if (status === "QUEUED") onQueued?.();
        if (SADAI_TASK_TERMINAL_STATUSES.has(status)) {
            const data = Array.isArray(payload?.response?.data) ? payload.response.data : [];
            const urls = data.map((item: { url?: unknown }) => (typeof item?.url === "string" ? item.url : "")).filter(Boolean);
            if (status !== "SUCCESS") throw new Error(String(payload?.error?.message || `SADAI 异步任务${status === "FAILED" ? "失败" : "已取消"}`).slice(0, 200));
            if (!urls.length) throw new Error("SADAI 异步任务完成但没有返回图片地址");
            return { urls: urls.map((url: string) => assertAllowedUpstreamUrl(url).toString()), status };
        }
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
    }
}

async function requestJson(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number, fetchImpl: typeof fetch, stage: "submit" | "poll") {
    if (signal.aborted) throw abortError(signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("SADAI 请求超时", "TimeoutError")), Math.max(1, timeoutMs));
    try {
        const response = await fetchImpl(url, { ...init, signal: AbortSignal.any([signal, controller.signal]) });
        const text = await response.text();
        let payload: Record<string, any> | undefined;
        try { payload = JSON.parse(text); } catch { /* Preserve HTTP status for non-JSON endpoint errors. */ }
        if (!response.ok) throw new SadaiTaskHttpError(response.status, stage,
            String(payload?.error?.message || payload?.message || `SADAI 任务请求失败（HTTP ${response.status}）`).slice(0, 200));
        if (!payload || typeof payload !== "object") throw new Error(`SADAI 返回了无法解析的响应（HTTP ${response.status}）`);
        return payload;
    } finally {
        clearTimeout(timeout);
    }
}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            reject(abortError(signal));
        };
        const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
    });
}

function abortError(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

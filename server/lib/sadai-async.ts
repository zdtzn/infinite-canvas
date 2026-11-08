import { assertAllowedUpstreamUrl } from "./url-policy";

const SADAI_TASK_POLL_INTERVAL_MS = 2_500;
const SADAI_TASK_MAX_WAIT_MS = 15 * 60_000;
const SADAI_TASK_TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "CANCELED", "CANCELLED"]);

export type SadaiAsyncTaskResult = { urls: string[]; status: string };

/** 提交一个 SADAI 异步生图任务，返回任务编号。提交失败会抛出，由调用方决定是否降级。 */
export async function submitSadaiAsyncTask(
    endpointBase: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    fetchImpl: typeof fetch = fetch,
): Promise<string> {
    const response = await fetchImpl(`${endpointBase}/images/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    const payload = await readJson(response);
    const id = String(payload?.id || payload?.task_id || "");
    if (!response.ok || !id) {
        const message = String(payload?.error?.message || payload?.message || "").slice(0, 200);
        throw new Error(message || `SADAI 异步任务提交失败（HTTP ${response.status}）`);
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
): Promise<SadaiAsyncTaskResult> {
    const deadline = Date.now() + SADAI_TASK_MAX_WAIT_MS;
    for (;;) {
        if (signal.aborted) throw abortError(signal);
        const response = await fetchImpl(`${endpointBase}/images/tasks/${encodeURIComponent(taskId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(String(payload?.error?.message || `SADAI 任务查询失败（HTTP ${response.status}）`).slice(0, 200));
        const status = String(payload?.status || "").toUpperCase();
        if (status === "QUEUED") onQueued?.();
        if (SADAI_TASK_TERMINAL_STATUSES.has(status)) {
            const data = Array.isArray(payload?.response?.data) ? payload.response.data : [];
            const urls = data.map((item: { url?: unknown }) => (typeof item?.url === "string" ? item.url : "")).filter(Boolean);
            if (status !== "SUCCESS") throw new Error(String(payload?.error?.message || `SADAI 异步任务${status === "FAILED" ? "失败" : "已取消"}`).slice(0, 200));
            if (!urls.length) throw new Error("SADAI 异步任务完成但没有返回图片地址");
            return { urls: urls.map((url: string) => assertAllowedUpstreamUrl(url).toString()), status };
        }
        if (Date.now() > deadline) throw new Error("SADAI 异步任务等待超时");
        await sleep(pollIntervalMs, signal);
    }
}

async function readJson(response: Response) {
    const text = await response.text();
    try {
        return JSON.parse(text) as Record<string, any>;
    } catch {
        throw new Error(`SADAI 返回了无法解析的响应（HTTP ${response.status}）`);
    }
}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(abortError(signal));
        }, { once: true });
    });
}

function abortError(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

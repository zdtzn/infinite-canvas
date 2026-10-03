// A public-mode browser fixture. All storage, HTTP and provider calls stay in memory.
import assert from "node:assert/strict";
import localforage from "localforage";
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

const preferences = new Map<string, string>();
const localStorage = {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => {
        preferences.set(key, value);
    },
    removeItem: (key: string) => {
        preferences.delete(key);
    },
};
const browser = Object.assign(new EventTarget(), { __RUNTIME_CONFIG__: { PUBLIC_MODE: true }, setTimeout, clearTimeout, localStorage });
Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
const stores = new Map<string, Map<string, unknown>>();
localforage.createInstance = ((options: { storeName: string }) => {
    const values = stores.get(options.storeName) || new Map<string, unknown>();
    stores.set(options.storeName, values);
    return {
        async getItem(key: string) {
            return structuredClone(values.get(key) ?? null);
        },
        async setItem(key: string, value: unknown) {
            values.set(key, structuredClone(value));
            return value;
        },
        async removeItem(key: string) {
            values.delete(key);
        },
        async iterate(callback: (value: unknown, key: string, iteration: number) => unknown) {
            let iteration = 0;
            for (const [key, value] of values) {
                const result = callback(structuredClone(value), key, ++iteration);
                if (result !== undefined) return result;
            }
        },
    };
}) as unknown as typeof localforage.createInstance;

const { normalizeGenerationHistoryItem } = await import("../../../../server/lib/generation-history");
const remote = new Map<string, Map<string, Record<string, unknown>>>();
const historyWrites: Array<{ owner: string; item: Record<string, unknown> }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith("/api/generation-history/video"), `unexpected HTTP request: ${url}`);
    const owner = new Headers(init?.headers).get("X-Expected-User-Id") || "";
    assert.ok(owner);
    const records = remote.get(owner) || new Map<string, Record<string, unknown>>();
    remote.set(owner, records);
    if (init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        const items = payload.items || [payload.item];
        for (const item of items) {
            const canonical = normalizeGenerationHistoryItem("video", item, undefined, () => undefined).payload;
            records.set(String(item.id), canonical);
            historyWrites.push({ owner, item: canonical });
        }
        return Response.json(payload.item ? { item: records.get(payload.item.id) } : { items: [...records.values()] });
    }
    if (init?.method === "DELETE") {
        const ids = JSON.parse(String(init.body)).ids as string[];
        ids.forEach((id) => records.delete(id));
        return Response.json({ deleted: ids.length, removedJobs: 0 });
    }
    assert.ok(!init?.method || init.method === "GET");
    return Response.json({ items: [...records.values()], hasMore: false });
}) as typeof fetch;

const requests: InternalAxiosRequestConfig[] = [];
let created = 0;
let failTasks = true;
axios.defaults.adapter = (async (request) => {
    requests.push(request);
    assert.equal(request.headers.get("X-Expected-User-Id"), "alice");
    assert.equal(request.headers.has("Authorization"), false);
    assert.ok(request.url?.startsWith("/api/ai/original/openai/videos"));
    const data = request.method === "post" ? { id: `provider-${++created}` } : failTasks ? { status: "failed", error: { message: "fixture failure" } } : { status: "running" };
    return { data, status: 200, statusText: "OK", headers: {}, config: request };
}) satisfies AxiosAdapter;

const { defaultConfig, useConfigStore } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { videoTasks } = await import("@/stores/use-video-task-store");
const { loadVideoHistory } = await import("../video-task-history");
const config = {
    ...structuredClone(defaultConfig),
    model: "original::movie",
    videoModel: "original::movie",
    videoSeconds: "8",
    channels: [{ id: "original", name: "Original", baseUrl: "https://fixture.invalid", apiKey: "must-not-persist", credentialState: "saved" as const, apiFormat: "openai" as const, models: [{ name: "movie", capability: "video" as const }] }],
};
useConfigStore.setState({ config });
const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "" });
async function until(check: () => boolean) {
    const end = Date.now() + 2500;
    while (!check()) {
        assert.ok(Date.now() < end, "fixture did not settle");
        await Bun.sleep(1);
    }
}

try {
    useUserStore.getState().setSession(user("alice"));
    await videoTasks.prepare("alice");
    const draft = { text: "原始请求", config, references: [], videoReferences: [], audioReferences: [] };
    const id = videoTasks.enqueue(draft);
    draft.text = "另一个草稿";
    draft.config.videoSeconds = "19";
    await until(() => videoTasks.store.getState().logs.find((item) => item.id === id)?.phase === "failed");
    const retry = videoTasks.retry(id);
    await until(() => videoTasks.store.getState().logs.find((item) => item.id === retry)?.phase === "failed");
    const posts = requests.filter((request) => request.method === "post");
    assert.equal(posts.length, 2);
    posts.forEach((request) => {
        assert.equal((request.data as FormData).get("prompt"), "原始请求");
        assert.equal((request.data as FormData).get("seconds"), "8");
    });
    assert.notEqual(posts[0].headers.get("Idempotency-Key"), posts[1].headers.get("Idempotency-Key"), "explicit retries are separate paid tasks");
    assert.ok(!JSON.stringify(historyWrites).includes("must-not-persist"));

    failTasks = false;
    const pending = videoTasks.enqueue({ ...draft, config });
    await until(() => videoTasks.store.getState().logs.find((item) => item.id === pending)?.phase === "polling");
    await until(() => historyWrites.some((write) => write.item.id === pending && (write.item.task as { id?: string })?.id));
    const providerId = videoTasks.store.getState().logs.find((item) => item.id === pending)!.task!.id;
    const beforeRestore = requests.length;
    await videoTasks.prepare("");
    await videoTasks.prepare("alice");
    await until(() => requests.length > beforeRestore);
    assert.equal(requests.filter((request) => request.method === "post").length, 3, "restoration must issue no additional POST");
    const restored = videoTasks.store.getState().logs.find((item) => item.id === pending)!;
    assert.equal(restored.task?.id, providerId);
    assert.equal(restored.task?.ownerUserId, "alice", "server strips nested owner, hydration must rebind it");
    videoTasks.stop(pending);
    await until(() => remote.get("alice")?.get(pending)?.phase === "paused");
    await videoTasks.refresh();
    const beforePausedRefresh = requests.length;
    await videoTasks.refresh();
    assert.equal(requests.length, beforePausedRefresh, "opening task center must not restart stopped polling");

    const local = stores.get("video_generation_logs")!;
    local.set("unowned", { ...restored, id: "unowned", ownerUserId: undefined });
    useUserStore.getState().setSession(user("bob"));
    await videoTasks.prepare("bob");
    assert.deepEqual(videoTasks.store.getState().logs, []);
    assert.deepEqual(await loadVideoHistory("bob"), []);
    assert.ok(!historyWrites.some((write) => write.owner === "bob"), "another account must not acquire old or unowned browser records");
    assert.ok(local.has("unowned"), "do not delete unowned browser records as a side effect");
    console.log("public video integration passed: original FormData retry, no automatic POST, owner headers, sanitized history, provider restore, paused refresh, account isolation");
} finally {
    useUserStore.getState().clearSession();
    await videoTasks.prepare("");
}

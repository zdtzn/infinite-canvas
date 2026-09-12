// Executed in an isolated process by src/services/app-sync.race.test.ts.
import { beforeEach, expect, mock, test } from "bun:test";

const buckets = new Map<string, Map<string, any>>();
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
mock.module("localforage", () => ({
    default: {
        createInstance: ({ storeName }: any) => {
            const data = new Map<string, any>();
            buckets.set(storeName, data);
            return {
                getItem: async (k: string) => data.get(k) ?? null,
                setItem: async (k: string, v: any) => {
                    data.set(k, v);
                },
                removeItem: async (k: string) => {
                    data.delete(k);
                },
                iterate: async (f: any) => {
                    for (const [k, v] of data) f(v, k);
                },
            };
        },
    },
}));
mock.module("@/constant/runtime-config", () => ({ PUBLIC_MODE: true }));
mock.module("@/services/api/local-proxy", () => ({ withLocalProxy: (url: string) => url }));
let user = "alice";
const userListeners = new Set<(state: { user: { id: string } }) => void>();
function switchUser(id: string) {
    user = id;
    userListeners.forEach((listener) => listener({ user: { id } }));
}
mock.module("@/stores/use-user-store", () => ({
    useUserStore: {
        getState: () => ({ user: { id: user } }),
        subscribe: (listener: (state: { user: { id: string } }) => void) => {
            userListeners.add(listener);
            return () => userListeners.delete(listener);
        },
    },
}));
let assetOwner = "alice";
const assets: any[] = [];
mock.module("@/stores/use-asset-store", () => ({ useAssetStore: { getState: () => ({ hydrated: true, ownerUserId: assetOwner, assets, loadAllServerAssets: async () => {}, replaceAssets: () => {} }), subscribe: () => () => {} } }));
const media = new Map<string, Blob>();
const mediaWrites: string[] = [];
mock.module("@/services/image-storage", () => ({
    getImageBlob: async (k: string) => media.get(k),
    setImageBlob: async (k: string, b: Blob) => {
        mediaWrites.push(user);
        media.set(k, b);
    },
    resolveImageUrl: async () => "",
}));
mock.module("@/services/file-storage", () => ({ getMediaBlob: async (k: string) => media.get(k), setMediaBlob: async () => {}, resolveMediaUrl: async () => "" }));
const { useCanvasStore, normalizeCanvasProject } = await import("@/stores/canvas/use-canvas-store");
const { syncAppDataToWebdav } = await import("../src/services/app-sync");
globalThis.window = globalThis as any;
const config = { url: "https://mock.invalid", directory: "sync", username: "fake", password: "fake" } as any;
const remote = new Map<string, { body: Blob; etag: string }>();
const puts: string[] = [];
let intercept: (path: string, init: RequestInit) => Promise<void> = async () => {};
let version = 0;
const pathOf = (domain: string) => `/sync/users/alice/${domain}/manifest.json`;
function manifest(projects: any[], deleted: any[] = [], files: any[] = []) {
    return new Blob([JSON.stringify({ app: "infinite-canvas", version: 1, domain: "canvas", data: { projects, deleted }, files })]);
}
const project = (id: string, key?: string) => normalizeCanvasProject({ id, updatedAt: "2026-01-01T00:00:00Z", nodes: key ? [{ id: "node", metadata: { storageKey: key } }] : [] })!;
beforeEach(() => {
    user = assetOwner = "alice";
    media.clear();
    mediaWrites.length = puts.length = 0;
    remote.clear();
    buckets.forEach((b) => b.clear());
    version = 0;
    intercept = async () => {};
    useCanvasStore.setState({ hydrated: true, ownerUserId: user, projects: [], deletedProjects: [], deletedProjectsByUser: {} });
    globalThis.fetch = mock(async (input: any, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname;
        await intercept(path, init);
        if (init.method === "MKCOL") return new Response(null, { status: 201 });
        if (init.method === "GET") {
            const item = remote.get(path);
            return item ? new Response(item.body, { headers: { ETag: item.etag } }) : new Response(null, { status: 404 });
        }
        if (init.method === "PUT") {
            const headers = new Headers(init.headers);
            const current = remote.get(path);
            if ((headers.get("If-None-Match") === "*" && current) || (headers.has("If-Match") && headers.get("If-Match") !== current?.etag)) return new Response(null, { status: 412 });
            puts.push(path);
            remote.set(path, { body: init.body as Blob, etag: `"${++version}"` });
            return new Response(null, { status: 201 });
        }
        throw new Error(`Unexpected mock request ${init.method} ${path}`);
    }) as any;
});

test("two devices: concurrent creation preserves the other device's deletion and new project", async () => {
    useCanvasStore.setState({ projects: [project("stale"), project("mine")] });
    let raced = false;
    intercept = async (path, init) => {
        if (!raced && path === pathOf("canvas") && init.method === "PUT") {
            raced = true;
            remote.set(path, { body: manifest([project("theirs")], [{ id: "stale", deletedAt: "2026-02-01T00:00:00Z", serverDeleted: true }]), etag: '"other-device"' });
        }
    };
    await syncAppDataToWebdav(config);
    const data = JSON.parse(await remote.get(pathOf("canvas"))!.body.text()).data;
    expect(data.projects.map((p: any) => p.id).sort()).toEqual(["mine", "theirs"]);
    expect(data.deleted.map((p: any) => p.id)).toEqual(["stale"]);
});

test("asset store from another account is rejected before any request", async () => {
    assetOwner = "bob";
    await expect(syncAppDataToWebdav(config)).rejects.toThrow("账户");
    expect(fetch).not.toHaveBeenCalled();
});

test("account switch during media GET cannot write media into the new account", async () => {
    remote.set(pathOf("canvas"), { body: manifest([project("remote", "image:remote")], [], [{ storageKey: "image:remote", path: "canvas/files/remote.png", mimeType: "image/png", bytes: 1 }]), etag: '"1"' });
    remote.set("/sync/users/alice/canvas/files/remote.png", { body: new Blob(["x"]), etag: '"2"' });
    intercept = async (path, init) => {
        if (path.endsWith("remote.png") && init.method === "GET") user = "bob";
    };
    await expect(syncAppDataToWebdav(config)).rejects.toThrow("账户");
    expect(mediaWrites).toEqual([]);
});

test("confirmed deletion during upload is included without publishing unuploaded new media", async () => {
    media.set("image:old", new Blob(["old"]));
    media.set("image:new", new Blob(["new"]));
    useCanvasStore.setState({ projects: [project("old", "image:old")] });
    intercept = async (path, init) => {
        if (path.includes("/files/") && init.method === "PUT") useCanvasStore.setState({ projects: [project("new", "image:new")], deletedProjects: [{ id: "old", deletedAt: "2026-02-01T00:00:00Z", serverDeleted: true }] });
    };
    await syncAppDataToWebdav(config);
    const saved = JSON.parse(await remote.get(pathOf("canvas"))!.body.text());
    expect(saved.data.projects.some((p: any) => p.id === "old")).toBe(false);
    expect(saved.data.deleted[0].id).toBe("old");
    for (const p of saved.data.projects) for (const node of p.nodes) expect(saved.files.some((f: any) => f.storageKey === node.metadata.storageKey)).toBe(true);
    expect(useCanvasStore.getState().projects[0].id).toBe("new");
});

test("switching away and back cannot revive a stale sync session", async () => {
    intercept = async (_path, init) => {
        if (init.method === "GET") {
            switchUser("bob");
            switchUser("alice");
        }
    };
    await expect(syncAppDataToWebdav(config)).rejects.toThrow("账户");
    expect(puts).toEqual([]);
    expect(userListeners.size).toBe(0);
});

test("missing strong ETag refuses to overwrite an existing remote manifest", async () => {
    remote.set(pathOf("canvas"), { body: manifest([project("remote")]), etag: 'W/"weak"' });
    await expect(syncAppDataToWebdav(config)).rejects.toThrow("强 ETag");
    expect(puts).not.toContain(pathOf("canvas"));
    expect(JSON.parse(await remote.get(pathOf("canvas"))!.body.text()).data.projects[0].id).toBe("remote");
});

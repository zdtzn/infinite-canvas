import { afterEach, expect, test } from "bun:test";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { createVideoLog, videoAssetFromLog, videoDownloadName, videoSnapshotFromLog, type VideoGenerationLog, type VideoSnapshot } from "./video-task-model";
import { createVideoTaskRuntime, VIDEO_TASK_QUEUE_LIMIT } from "./video-task-runtime";
import type { VideoGenerationTask, VideoGenerationTaskState } from "./api/video";

function snapshot(text = "原始镜头"): VideoSnapshot {
    const config = structuredClone(defaultConfig);
    config.videoModel = config.model = "original::movie";
    config.channels = [{ id: "original", name: "原渠道", apiKey: "fixture-secret", baseUrl: "https://fixture.invalid", apiFormat: "openai", models: [{ name: "movie", capability: "video" }] }];
    config.videoSeconds = "8";
    return {
        text,
        config,
        references: [{ id: "image", name: "原图", type: "image/png", dataUrl: "/original.png" }],
        videoReferences: [{ id: "video", name: "原视频", type: "video/mp4", url: "/reference.mp4" }],
        audioReferences: [{ id: "audio", name: "原音频", type: "audio/mpeg", url: "/reference.mp3" }],
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check()) {
        if (Date.now() > end) throw new Error("fixture did not settle");
        await Bun.sleep(1);
    }
}
function aborted(signal: AbortSignal) {
    return new Promise<void>((_, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
    });
}
const cleanups: Array<() => void> = [];
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
});

function fixture(initial: VideoGenerationLog[] = []) {
    let owner = "account-a";
    let config = snapshot().config;
    const stored = new Map(initial.map((log) => [log.id, structuredClone(log)]));
    const creates: VideoSnapshot[] = [];
    const polls: string[] = [];
    const saved: VideoGenerationLog[] = [];
    const deleted = new Set<string>();
    let createImpl = async (): Promise<VideoGenerationTask> => ({ id: `provider-${creates.length}`, model: "original::movie", provider: "openai", ownerUserId: owner });
    let pollImpl = async (_log: VideoGenerationLog, _signal: AbortSignal): Promise<VideoGenerationTaskState> => ({ status: "pending" });
    let loads = 0;
    const runtime = createVideoTaskRuntime({
        currentOwner: () => owner,
        load: async (id) => {
            loads++;
            return structuredClone([...stored.values()].filter((log) => log.ownerUserId === id));
        },
        save: async (log, id) => {
            expect(log.ownerUserId).toBe(id);
            if (deleted.has(log.id)) return undefined;
            stored.set(log.id, structuredClone(log));
            saved.push(structuredClone(log));
            return log;
        },
        remove: async (ids) => {
            ids.forEach((id) => stored.delete(id));
        },
        snapshot: (log) => videoSnapshotFromLog(log, config),
        create: async (input) => {
            creates.push(structuredClone(input));
            return createImpl();
        },
        poll: async (log, _input, _owner, signal) => {
            polls.push(log.task!.id);
            return pollImpl(log, signal);
        },
        archive: async (_result, log) => ({ id: `video-${log.id}`, url: `/result-${log.id}.mp4`, storageKey: "", width: 1280, height: 720, bytes: 64, mimeType: "video/mp4", durationMs: 2 }),
        wait: (_ms, signal) => aborted(signal),
    });
    cleanups.push(() => {
        owner = "";
        void runtime.prepare("");
    });
    return {
        runtime,
        creates,
        polls,
        saved,
        stored,
        deleted,
        loads: () => loads,
        config: (next: AiConfig) => {
            config = next;
        },
        owner: async (next: string) => {
            owner = next;
            await runtime.prepare(next);
        },
        create: (fn: typeof createImpl) => {
            createImpl = fn;
        },
        poll: (fn: typeof pollImpl) => {
            pollImpl = fn;
        },
        log: (id: string) => runtime.store.getState().logs.find((log) => log.id === id)!,
    };
}

test("old-result retry, asset metadata and download name use deep snapshots of all references and settings", async () => {
    const f = fixture();
    f.poll(async () => ({ status: "failed", error: "provider failed" }));
    await f.runtime.prepare("account-a");
    const draft = snapshot();
    const id = f.runtime.enqueue(draft);
    draft.text = "新草稿";
    draft.config.videoSeconds = "19";
    draft.references[0].name = "新图片";
    draft.videoReferences[0].url = "/new.mp4";
    draft.audioReferences[0].url = "/new.mp3";
    await until(() => f.log(id).phase === "failed");
    f.config(draft.config);
    const retryId = f.runtime.retry(id);
    await until(() => f.log(retryId).phase === "failed");
    expect(f.creates).toHaveLength(2);
    for (const sent of f.creates) {
        expect(sent.text).toBe("原始镜头");
        expect(sent.config.videoSeconds).toBe("8");
        expect(sent.references[0].name).toBe("原图");
        expect(sent.videoReferences[0].url).toBe("/reference.mp4");
        expect(sent.audioReferences[0].url).toBe("/reference.mp3");
    }
    const log = { ...f.log(id), video: { id: "v", url: "/old.mp4", storageKey: "", width: 1, height: 1, bytes: 2, durationMs: 1, mimeType: "video/mp4" } };
    const asset = videoAssetFromLog(log);
    expect(asset.metadata.prompt).toBe("原始镜头");
    expect(asset.metadata.config.videoSeconds).toBe("8");
    expect(asset.metadata.references[0].name).toBe("原图");
    expect(videoDownloadName(log)).toStartWith("原始镜头_");
    expect(JSON.stringify(f.saved)).not.toContain("fixture-secret");
});

test("two independent workers, bounded queue, no paid submission for a removed queued item", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    const ids = Array.from({ length: VIDEO_TASK_QUEUE_LIMIT }, (_, i) => f.runtime.enqueue(snapshot(`任务${i}`)));
    await until(() => f.polls.length === 2);
    expect(f.creates.length).toBe(2);
    expect(f.runtime.store.getState().logs.filter((log) => log.phase === "queued").length).toBe(18);
    expect(() => f.runtime.enqueue(snapshot())).toThrow("20");
    f.runtime.stop(ids[2]);
    expect(f.log(ids[2]).phase).toBe("canceled");
    f.runtime.stop(ids[0]);
    await until(() => f.creates.length === 3);
    expect(f.creates.map((item) => item.text)).toEqual(["任务0", "任务1", "任务3"]);
    expect(f.log(ids[1]).phase).toBe("polling");
    expect(f.log(ids[0]).error).toContain("上游可能仍在生成和计费");
});

test("route subscribers can unmount and remount without restarting or duplicating polling", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    const first = f.runtime.store.subscribe(() => {});
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.polls.length === 1);
    first();
    const second = f.runtime.store.subscribe(() => {});
    await Promise.all([f.runtime.prepare("account-a"), f.runtime.prepare("account-a"), f.runtime.refresh(), f.runtime.refresh()]);
    f.runtime.resume(id);
    f.runtime.resume(id);
    expect(f.creates.length).toBe(1);
    expect(f.polls.length).toBe(1);
    expect(f.log(id).phase).toBe("polling");
    second();
});

test("task-specific stop and resume only query the original provider ID", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    const a = f.runtime.enqueue(snapshot("A")),
        b = f.runtime.enqueue(snapshot("B"));
    await until(() => f.polls.length === 2);
    const providerId = f.log(a).task!.id;
    f.runtime.stop(a);
    await Bun.sleep(1);
    expect(f.log(b).phase).toBe("polling");
    expect(f.log(a).phase).toBe("paused");
    expect(f.log(a).error).toContain("上游可能仍在生成和计费");
    f.poll(async (log) => (log.id === a ? { status: "completed", result: { url: "/done.mp4" } } : { status: "pending" }));
    f.runtime.resume(a);
    f.runtime.resume(a);
    await until(() => f.log(a).phase === "succeeded");
    expect(f.creates.length).toBe(2);
    expect(f.polls.filter((id) => id === providerId).length).toBe(2);
    expect(f.log(b).phase).toBe("polling");
});

test("stopping while a creation response is in flight retains its ID without polling", async () => {
    const f = fixture();
    const created = deferred<VideoGenerationTask>();
    f.create(() => created.promise);
    await f.runtime.prepare("account-a");
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.creates.length === 1);
    f.runtime.stop(id);
    created.resolve({ id: "late-id", model: "original::movie", provider: "openai" });
    await until(() => f.log(id).phase === "paused");
    expect(f.log(id).task?.id).toBe("late-id");
    expect(f.polls.length).toBe(0);
    expect(f.creates.length).toBe(1);
});

test("reload queries existing IDs only; queued and uncertain creations never resubmit automatically", async () => {
    const base = createVideoLog(snapshot(), "account-a");
    const f = fixture([
        { ...base, id: "active", phase: "polling", task: { id: "recover-id", model: base.model, provider: "seedance" } },
        { ...base, id: "queued", phase: "queued" },
        { ...base, id: "submitting", phase: "submitting" },
        { ...base, id: "stopped", phase: "paused", task: { id: "paused-id", model: base.model, provider: "openai" } },
    ]);
    await f.runtime.prepare("account-a");
    await until(() => f.polls.length === 1);
    expect(f.creates.length).toBe(0);
    expect(f.polls).toEqual(["recover-id"]);
    expect(f.log("queued").phase).toBe("paused");
    expect(f.log("submitting").phase).toBe("unknown");
    expect(f.log("stopped").phase).toBe("paused");
    await f.runtime.refresh();
    await f.runtime.refresh();
    expect(f.creates.length).toBe(0);
    expect(f.polls).toEqual(["recover-id"]);
    expect(f.log("queued").phase).toBe("paused");
});

test("ambiguous paid creation failures are never retried automatically, including after reload", async () => {
    const f = fixture();
    f.create(async () => {
        throw new Error("response lost");
    });
    await f.runtime.prepare("account-a");
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.log(id).phase === "unknown");
    expect(f.creates.length).toBe(1);
    expect(f.log(id).error).toContain("可能重复计费");
    await f.owner("");
    await f.owner("account-a");
    expect(f.creates.length).toBe(1);
    expect(f.polls.length).toBe(0);
    expect(f.log(id).phase).toBe("unknown");
});

test("account changes suppress stale results and store late task IDs only for the original owner", async () => {
    const f = fixture();
    const created = deferred<VideoGenerationTask>();
    f.create(() => created.promise);
    await f.runtime.prepare("account-a");
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.creates.length === 1);
    await f.owner("account-b");
    created.resolve({ id: "old-owner-id", model: "original::movie", provider: "openai" });
    await until(() => f.stored.get(id)?.task?.id === "old-owner-id");
    expect(f.runtime.store.getState().logs).toEqual([]);
    expect(f.stored.get(id)?.ownerUserId).toBe("account-a");
    expect(f.stored.get(id)?.phase).toBe("paused");
    expect(f.polls.length).toBe(0);
});

test("restoration never falls back to a different provider or changed local endpoint", () => {
    const original = snapshot();
    const log = createVideoLog(original, "account-a");
    const changed = structuredClone(original.config);
    changed.channels[0].id = "replacement";
    expect(() => videoSnapshotFromLog(log, changed)).toThrow("原视频渠道已不可用");
    changed.channels[0].id = "original";
    changed.channels[0].baseUrl = "https://other.invalid";
    expect(() => videoSnapshotFromLog(log, changed)).toThrow("原视频渠道配置已变更");
});

test("the account concurrency limit also limits queued submissions", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    f.runtime.setConcurrency(1);
    f.runtime.enqueue(snapshot("one"));
    f.runtime.enqueue(snapshot("two"));
    await until(() => f.polls.length === 1);
    expect(f.creates.length).toBe(1);
    expect(f.runtime.store.getState().logs.filter((log) => log.phase === "queued").length).toBe(1);
});

test("a remounted route sees completion and persistence of its original independent task", async () => {
    const f = fixture();
    const result = deferred<VideoGenerationTaskState>();
    f.poll(() => result.promise);
    await f.runtime.prepare("account-a");
    const off = f.runtime.store.subscribe(() => {});
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.polls.length === 1);
    off();
    result.resolve({ status: "completed", result: { url: "/original.mp4" } });
    await until(() => f.stored.get(id)?.phase === "succeeded");
    await f.runtime.prepare("account-a");
    expect(f.log(id).video?.url).toBe(`/result-${id}.mp4`);
    expect(f.creates.length).toBe(1);
    expect(f.polls.length).toBe(1);
});

test("late poll results cannot change the next account or resurrect a deleted record", async () => {
    const f = fixture();
    const result = deferred<VideoGenerationTaskState>();
    f.poll(() => result.promise);
    await f.runtime.prepare("account-a");
    const id = f.runtime.enqueue(snapshot());
    await until(() => f.polls.length === 1);
    await expect(f.runtime.remove([id])).rejects.toThrow("请先停止查询");
    f.runtime.stop(id);
    await f.runtime.remove([id]);
    await f.owner("account-b");
    result.resolve({ status: "completed", result: { url: "/old-owner.mp4" } });
    await Bun.sleep(1);
    expect(f.runtime.store.getState().logs).toEqual([]);
    expect(f.stored.has(id)).toBe(false);
});

test("resuming a removed queue item cannot exceed the outstanding task bound", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    const ids = Array.from({ length: VIDEO_TASK_QUEUE_LIMIT }, () => f.runtime.enqueue(snapshot()));
    f.runtime.stop(ids.at(-1)!);
    f.runtime.enqueue(snapshot());
    expect(() => f.runtime.resume(ids.at(-1)!)).toThrow("20");
});

test("a history read that lags a newly queued record cannot drop the live queue item", async () => {
    const f = fixture();
    await f.runtime.prepare("account-a");
    f.runtime.enqueue(snapshot("first"));
    f.runtime.enqueue(snapshot("second"));
    const queued = f.runtime.enqueue(snapshot("third"));
    await until(() => f.polls.length === 2);
    f.stored.delete(queued); // The remote history has not observed the queue write yet.
    await f.runtime.refresh();
    expect(f.log(queued).phase).toBe("queued");
    expect(f.creates.length).toBe(2);
});

test("resuming persists the tracking choice so a later reload continues the same ID", async () => {
    const original = createVideoLog(snapshot(), "account-a");
    const f = fixture([{ ...original, phase: "paused", trackingStopped: true, task: { id: "resume-id", model: original.model, provider: "openai" } }]);
    await f.runtime.prepare("account-a");
    f.runtime.resume(original.id);
    await until(() => f.polls.length === 1);
    expect(f.stored.get(original.id)?.trackingStopped).toBe(false);
    expect(f.stored.get(original.id)?.phase).toBe("polling");
    await f.owner("");
    await f.owner("account-a");
    await until(() => f.polls.length === 2);
    expect(f.polls).toEqual(["resume-id", "resume-id"]);
    expect(f.creates.length).toBe(0);
});

test("a server tombstone encountered on resume prevents further provider polling", async () => {
    const original = createVideoLog(snapshot(), "account-a");
    const f = fixture([{ ...original, phase: "paused", task: { id: "deleted-id", model: original.model, provider: "openai" } }]);
    await f.runtime.prepare("account-a");
    f.deleted.add(original.id);
    f.runtime.resume(original.id);
    await until(() => !f.runtime.store.getState().logs.length);
    expect(f.polls).toEqual([]);
    expect(f.creates).toEqual([]);
});

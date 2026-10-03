import { createStore } from "zustand/vanilla";
import { createVideoLog, isActiveVideoTask, videoTaskPhase, type GeneratedVideo, type VideoGenerationLog, type VideoSnapshot } from "./video-task-model";
import { queryVideoTask } from "@/pages/video/query-task";
import type { VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState } from "@/services/api/video";

export const VIDEO_TASK_CONCURRENCY = 2;
export const VIDEO_TASK_QUEUE_LIMIT = 20;
type Dependencies = {
    currentOwner: () => string;
    load: (owner: string) => Promise<VideoGenerationLog[]>;
    save: (log: VideoGenerationLog, owner: string) => Promise<VideoGenerationLog | undefined>;
    remove: (ids: string[], owner: string) => Promise<void>;
    snapshot: (log: VideoGenerationLog) => VideoSnapshot;
    create: (snapshot: VideoSnapshot, owner: string, signal: AbortSignal) => Promise<VideoGenerationTask>;
    poll: (log: VideoGenerationLog, snapshot: VideoSnapshot, owner: string, signal: AbortSignal) => Promise<VideoGenerationTaskState>;
    archive: (result: VideoGenerationResult, log: VideoGenerationLog, owner: string) => Promise<GeneratedVideo>;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    onUpdate?: (log: VideoGenerationLog) => void;
};
type State = { ownerId: string; logs: VideoGenerationLog[]; loading: boolean; error?: string; selectedId: string | null };
type Worker = { controller: AbortController; submitted: boolean };

export function createVideoTaskRuntime(deps: Dependencies) {
    const store = createStore<State>(() => ({ ownerId: "", logs: [], loading: false, selectedId: null }));
    const workers = new Map<string, Worker>();
    const snapshots = new Map<string, VideoSnapshot>();
    const removed = new Set<string>();
    let version = 0;
    let concurrency = VIDEO_TASK_CONCURRENCY;
    let loading: Promise<void> | undefined;
    const wait = deps.wait || abortableDelay;
    const owns = (owner: string, epoch: number) => version === epoch && store.getState().ownerId === owner && deps.currentOwner() === owner;
    const get = (id: string) => store.getState().logs.find((log) => log.id === id);

    function update(id: string, patch: Partial<VideoGenerationLog>) {
        const previous = get(id);
        if (!previous || removed.has(id)) return undefined;
        const next = { ...previous, ...patch, updatedAt: Math.max(Date.now(), (previous.updatedAt || 0) + 1) };
        store.setState({ logs: store.getState().logs.map((log) => (log.id === id ? next : log)) });
        deps.onUpdate?.(next);
        return next;
    }
    function persist(log: VideoGenerationLog) {
        return deps.save(structuredClone(log), log.ownerUserId!);
    }
    function saveQuietly(log: VideoGenerationLog) {
        const epoch = version;
        void persist(log).catch(() => {
            if (owns(log.ownerUserId!, epoch)) store.setState({ error: "视频任务记录暂未保存，请保留页面并稍后同步" });
        });
    }

    function prepare(owner: string) {
        if (store.getState().ownerId === owner) return loading || Promise.resolve();
        version += 1;
        workers.forEach((worker) => worker.controller.abort());
        workers.clear();
        snapshots.clear();
        removed.clear();
        loading = undefined;
        store.setState({ ownerId: owner, logs: [], loading: Boolean(owner), selectedId: null, error: undefined });
        return owner ? refresh() : Promise.resolve();
    }

    function refresh(): Promise<void> {
        if (loading) return loading;
        const { ownerId: owner, logs: before } = store.getState();
        const epoch = version;
        if (!owner || !owns(owner, epoch)) return Promise.resolve();
        store.setState({ loading: true, error: undefined });
        const pending = (async () => {
            try {
                const loaded = await deps.load(owner);
                if (!owns(owner, epoch)) return;
                const local = store.getState().logs;
                const byId = new Map(loaded.filter((log) => log.ownerUserId === owner && !removed.has(log.id)).map((log) => [log.id, log]));
                for (const log of local) {
                    if (!removed.has(log.id) && (workers.has(log.id) || snapshots.has(log.id) || before.find((item) => item.id === log.id) !== log)) byId.set(log.id, log);
                }
                const logs = [...byId.values()]
                    .map((log) => {
                        // A history refresh is also a restore for records without a live worker.
                        // Never turn a persisted pre-submission record into a new paid request.
                        if (workers.has(log.id) || snapshots.has(log.id)) return log;
                        const phase = videoTaskPhase(log);
                        if (phase === "submitting" && !log.task) return { ...log, phase: "unknown" as const, error: "创建结果未确认，上游可能已受理；请勿直接重复提交。" };
                        if (phase === "queued" && !log.task) return { ...log, phase: "paused" as const, error: "排队已暂停，尚未提交。继续排队后才会创建任务。" };
                        if (log.task && ["polling", "submitting", "queued"].includes(phase)) return { ...log, phase: log.trackingStopped ? ("paused" as const) : ("queued" as const) };
                        return log;
                    })
                    .sort((a, b) => b.createdAt - a.createdAt);
                store.setState({ logs });
            } catch (error) {
                if (owns(owner, epoch)) store.setState({ error: errorText(error, "视频任务恢复失败") });
            } finally {
                if (owns(owner, epoch)) {
                    loading = undefined;
                    store.setState({ loading: false });
                    pump();
                }
            }
        })();
        loading = pending;
        return pending;
    }

    function enqueue(input: VideoSnapshot, agentTaskId?: string) {
        const { ownerId, loading: restoring } = store.getState();
        if (!ownerId || ownerId !== deps.currentOwner()) throw new Error("账号已切换，请重新打开视频工作台");
        if (restoring) throw new Error("正在同步视频任务，请稍后提交");
        if (store.getState().logs.filter((log) => isActiveVideoTask(log) || ["paused", "unknown"].includes(videoTaskPhase(log))).length >= VIDEO_TASK_QUEUE_LIMIT) throw new Error(`最多保留 ${VIDEO_TASK_QUEUE_LIMIT} 个待处理视频任务，请先处理已有任务`);
        const snapshot = structuredClone(input);
        const log = createVideoLog(snapshot, ownerId, agentTaskId);
        snapshots.set(log.id, snapshot);
        store.setState({ logs: [log, ...store.getState().logs], selectedId: log.id });
        // Reserve the slot synchronously; another click/mount cannot start this task again.
        pump();
        if (!workers.has(log.id)) saveQuietly(log);
        return log.id;
    }

    function pump() {
        const { ownerId, logs } = store.getState();
        if (!ownerId || ownerId !== deps.currentOwner()) return;
        for (const log of [...logs].reverse()) {
            if (workers.size >= concurrency) break;
            if (log.phase !== "queued" || workers.has(log.id) || removed.has(log.id)) continue;
            const worker = { controller: new AbortController(), submitted: false };
            workers.set(log.id, worker);
            void run(log, worker, version);
        }
    }

    async function run(initial: VideoGenerationLog, worker: Worker, epoch: number) {
        const owner = initial.ownerUserId!;
        const signal = worker.controller.signal;
        const current = () => owns(owner, epoch) && !removed.has(initial.id) && workers.get(initial.id) === worker;
        let log = initial;
        let terminal = false;
        let creating = false;
        try {
            const snapshot = snapshots.get(log.id) || deps.snapshot(log);
            if (!log.task) {
                log = update(log.id, { phase: "submitting", error: undefined })!;
                const saved = await persist(log);
                if (!current() || signal.aborted) return;
                if (!saved) {
                    removed.add(log.id);
                    store.setState({ logs: store.getState().logs.filter((item) => item.id !== log.id) });
                    return;
                }
                worker.submitted = true;
                creating = true;
                // Creation is deliberately outside queryVideoTask: it is never retried automatically.
                const task = await deps.create(snapshot, owner, signal);
                creating = false;
                if (!current()) {
                    // A late provider ID belongs to the original account, even after logout.
                    if (version !== epoch) await persist({ ...log, task, phase: "paused", trackingStopped: true, updatedAt: Date.now(), error: "查询已停止，切回原账号后可继续查询原任务。" });
                    return;
                }
                log = update(log.id, { task, phase: get(log.id)?.trackingStopped ? "paused" : "polling" })!;
                await persist(log);
                if (!current() || signal.aborted || get(log.id)?.trackingStopped) return;
            }
            log = update(log.id, { phase: "polling", trackingStopped: false, error: undefined })!;
            if (initial.task && !(await persist(log))) {
                if (current()) {
                    removed.add(log.id);
                    store.setState({ logs: store.getState().logs.filter((item) => item.id !== log.id) });
                }
                return;
            }
            for (let attempt = 0; attempt < 120; attempt += 1) {
                if (!current() || signal.aborted) return;
                const state = await queryVideoTask(
                    () => deps.poll(log, snapshot, owner, signal),
                    (ms) => wait(ms, signal),
                    () => current() && !signal.aborted,
                );
                if (!current() || signal.aborted) return;
                if (state.status === "failed") {
                    terminal = true;
                    throw new Error(state.error);
                }
                if (state.status === "completed") {
                    const video = await deps.archive(state.result, log, owner);
                    if (!current() || signal.aborted) return;
                    log = update(log.id, { phase: "succeeded", status: "成功", video, durationMs: Date.now() - log.createdAt, error: undefined })!;
                    saveQuietly(log);
                    return;
                }
                if (attempt === 119) throw new Error("本轮查询已结束，结果尚未确认");
                await wait(log.task!.provider === "seedance" ? 5000 : 2500, signal);
            }
        } catch (error) {
            if (!current() || signal.aborted) return;
            const phase = terminal ? "failed" : creating ? "unknown" : log.task ? "paused" : "failed";
            log = update(log.id, {
                phase,
                status: terminal || phase === "failed" ? "失败" : "生成中",
                error: `${errorText(error, "视频任务处理失败")}${creating ? "。创建结果未确认，上游可能已受理；重新生成可能重复计费。" : log.task && !terminal ? "。查询已停止，可继续查询原任务，不会重新生成。" : ""}`,
                durationMs: Date.now() - log.createdAt,
            })!;
            saveQuietly(log);
        } finally {
            if (workers.get(initial.id) === worker) {
                workers.delete(initial.id);
                snapshots.delete(initial.id);
                pump();
            }
        }
    }

    function stop(id: string) {
        const log = get(id);
        if (!log || !isActiveVideoTask(log) || store.getState().ownerId !== deps.currentOwner()) return;
        const worker = workers.get(id);
        const receivingId = !log.task && worker?.submitted;
        const next = update(id, {
            phase: receivingId ? "submitting" : log.task ? "paused" : "canceled",
            trackingStopped: true,
            status: receivingId || log.task ? "生成中" : "失败",
            error: receivingId ? "已停止后续查询，正在接收任务编号；上游可能仍在生成和计费。" : log.task ? "已停止查询；上游可能仍在生成和计费，可继续查询原任务。" : "已移出队列，尚未提交。",
        })!;
        if (!receivingId) {
            worker?.controller.abort();
            snapshots.delete(id);
        }
        saveQuietly(next);
        pump();
    }

    function resume(id: string) {
        const log = get(id);
        if (!log || workers.has(id) || !["paused", "canceled"].includes(videoTaskPhase(log))) return;
        if (store.getState().ownerId !== deps.currentOwner()) return;
        if (videoTaskPhase(log) === "canceled" && store.getState().logs.filter((item) => isActiveVideoTask(item) || ["paused", "unknown"].includes(videoTaskPhase(item))).length >= VIDEO_TASK_QUEUE_LIMIT)
            throw new Error(`最多保留 ${VIDEO_TASK_QUEUE_LIMIT} 个待处理视频任务`);
        snapshots.set(id, deps.snapshot(log));
        const next = update(id, { phase: "queued", status: "生成中", trackingStopped: false, error: undefined })!;
        pump();
        if (!workers.has(id)) saveQuietly(next);
    }

    function retry(id: string) {
        const log = get(id);
        if (!log || !["failed", "unknown", "succeeded"].includes(videoTaskPhase(log))) throw new Error("请继续查询原任务，或先将其移出队列");
        return enqueue(deps.snapshot(log));
    }

    async function remove(ids: string[]) {
        const { ownerId } = store.getState();
        const epoch = version;
        if (!owns(ownerId, epoch)) throw new Error("账号已切换");
        const logs = store.getState().logs.filter((log) => ids.includes(log.id));
        if (logs.some((log) => isActiveVideoTask(log))) throw new Error("请先停止查询或移出队列，再删除任务记录");
        logs.forEach((log) => {
            removed.add(log.id);
            workers.get(log.id)?.controller.abort();
            snapshots.delete(log.id);
        });
        try {
            await deps.remove(
                logs.map((log) => log.id),
                ownerId,
            );
            if (owns(ownerId, epoch)) store.setState({ logs: store.getState().logs.filter((log) => !ids.includes(log.id)) });
        } catch (error) {
            if (owns(ownerId, epoch)) logs.forEach((log) => removed.delete(log.id));
            throw error;
        }
    }

    return {
        store,
        prepare,
        refresh,
        enqueue,
        stop,
        resume,
        retry,
        remove,
        select: (id: string | null) => store.setState({ selectedId: id }),
        setConcurrency: (limit: number) => {
            concurrency = Math.max(1, Math.min(VIDEO_TASK_CONCURRENCY, Math.floor(limit) || 1));
            pump();
        },
    };
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}
function abortableDelay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const finish = () => {
            signal.removeEventListener("abort", abort);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
    });
}

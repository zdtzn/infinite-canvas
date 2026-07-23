export type QueueJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type QueueJob<I, O> = {
    id: string;
    input: I;
    status: QueueJobStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    result?: O;
    error?: string;
};

type QueueOptions<I, O> = {
    concurrency: number;
    worker: (input: I, signal: AbortSignal, job: QueueJob<I, O>) => Promise<O>;
    onChange?: (job: QueueJob<I, O>) => void | Promise<void>;
};

export class JobQueue<I, O> {
    private readonly jobs = new Map<string, QueueJob<I, O>>();
    private readonly completions = new Map<string, { promise: Promise<O>; resolve: (value: O) => void; reject: (error: Error) => void }>();
    private readonly controllers = new Map<string, AbortController>();
    private active = 0;

    constructor(private readonly options: QueueOptions<I, O>) {}

    add(input: I, id = crypto.randomUUID()) {
        if (this.jobs.has(id)) return this.jobs.get(id)!;
        const job: QueueJob<I, O> = { id, input, status: "queued", createdAt: Date.now() };
        this.jobs.set(id, job);
        this.ensureCompletion(id);
        void this.initialize(job);
        return job;
    }

    restore(job: QueueJob<I, O>) {
        const restored = { ...job, status: job.status === "running" ? ("queued" as const) : job.status };
        this.jobs.set(restored.id, restored);
        this.ensureCompletion(restored.id);
        if (restored.status === "queued") queueMicrotask(() => this.drain());
        return restored;
    }

    list() {
        return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    get(id: string) {
        return this.jobs.get(id);
    }

    async touch(id: string) {
        const job = this.jobs.get(id);
        if (job) await this.changed(job);
    }

    wait(id: string) {
        const job = this.jobs.get(id);
        if (!job) return Promise.reject(new Error("任务不存在"));
        if (job.status === "succeeded") return Promise.resolve(job.result as O);
        if (job.status === "failed") return Promise.reject(new Error(job.error || "任务失败"));
        if (job.status === "canceled") return Promise.reject(new Error("任务已取消"));
        return this.ensureCompletion(id).promise;
    }

    cancel(id: string) {
        const job = this.jobs.get(id);
        if (!job || !["queued", "running"].includes(job.status)) return false;
        this.controllers.get(id)?.abort();
        job.status = "canceled";
        job.finishedAt = Date.now();
        job.error = "任务已取消";
        this.completions.get(id)?.reject(new Error(job.error));
        void this.changed(job).catch(() => undefined);
        return true;
    }

    remove(id: string) {
        const job = this.jobs.get(id);
        if (!job || ["queued", "running"].includes(job.status)) return false;
        this.jobs.delete(id);
        this.completions.delete(id);
        return true;
    }

    private drain() {
        while (this.active < Math.max(1, this.options.concurrency)) {
            const job = Array.from(this.jobs.values()).find((item) => item.status === "queued");
            if (!job) return;
            void this.run(job);
        }
    }

    private async initialize(job: QueueJob<I, O>) {
        try {
            await this.changed(job);
        } catch (error) {
            if (job.status !== "queued") return;
            job.status = "failed";
            job.error = error instanceof Error ? error.message : "任务持久化失败";
            job.finishedAt = Date.now();
            this.completions.get(job.id)?.reject(new Error(job.error));
            await this.changed(job).catch(() => undefined);
            return;
        }
        this.drain();
    }

    private async run(job: QueueJob<I, O>) {
        this.active += 1;
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        try {
            job.status = "running";
            job.startedAt = Date.now();
            await this.changed(job);
            const result = await this.options.worker(job.input, controller.signal, job);
            if (job.status === "canceled") return;
            job.status = "succeeded";
            job.result = result;
            job.finishedAt = Date.now();
            this.completions.get(job.id)?.resolve(result);
        } catch (error) {
            if (job.status === "canceled") return;
            job.status = "failed";
            job.error = error instanceof Error ? error.message : "任务失败";
            job.finishedAt = Date.now();
            this.completions.get(job.id)?.reject(new Error(job.error));
        } finally {
            this.controllers.delete(job.id);
            this.active -= 1;
            try {
                await this.changed(job);
            } catch {
                // Persistence errors must not strand a queue worker slot.
            }
            this.drain();
        }
    }

    private ensureCompletion(id: string) {
        const existing = this.completions.get(id);
        if (existing) return existing;
        let resolve = (_value: O) => undefined;
        let reject = (_error: Error) => undefined;
        const promise = new Promise<O>((onResolve, onReject) => {
            resolve = onResolve;
            reject = onReject;
        });
        promise.catch(() => undefined);
        const completion = { promise, resolve, reject };
        this.completions.set(id, completion);
        return completion;
    }

    private async changed(job: QueueJob<I, O>) {
        await this.options.onChange?.({ ...job });
    }
}

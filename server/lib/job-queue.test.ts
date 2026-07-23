import { describe, expect, test } from "bun:test";

import { JobQueue } from "./job-queue";

describe("persistent job queue runtime", () => {
    test("limits concurrency and continues queued work", async () => {
        let running = 0;
        let maxRunning = 0;
        const releases: Array<() => void> = [];
        const queue = new JobQueue<number, number>({
            concurrency: 2,
            worker: async (value) => {
                running += 1;
                maxRunning = Math.max(maxRunning, running);
                await new Promise<void>((resolve) => releases.push(resolve));
                running -= 1;
                return value * 2;
            },
        });

        const jobs = [queue.add(1), queue.add(2), queue.add(3)];
        await waitUntil(() => running === 2);
        expect(maxRunning).toBe(2);
        releases.shift()?.();
        await waitUntil(() => releases.length === 2);
        releases.splice(0).forEach((release) => release());
        expect(await Promise.all(jobs.map((job) => queue.wait(job.id)))).toEqual([2, 4, 6]);
    });

    test("cancels queued jobs without executing them", async () => {
        const executed: number[] = [];
        let releaseFirst = () => undefined;
        const queue = new JobQueue<number, number>({
            concurrency: 1,
            worker: async (value) => {
                executed.push(value);
                if (value === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
                return value;
            },
        });
        const first = queue.add(1);
        const second = queue.add(2);
        await waitUntil(() => executed.includes(1));
        expect(queue.cancel(second.id)).toBe(true);
        releaseFirst();
        expect(await queue.wait(first.id)).toBe(1);
        await expect(queue.wait(second.id)).rejects.toThrow("取消");
        expect(executed).toEqual([1]);
    });

    test("persists input updates while a job is running", async () => {
        let release = () => undefined;
        const changes: Array<{ id: string; input: { taskId?: string } }> = [];
        const queue = new JobQueue<{ taskId?: string }, number>({
            concurrency: 1,
            worker: async (input) => {
                input.taskId = "remote-task";
                await new Promise<void>((resolve) => (release = resolve));
                return 1;
            },
            onChange: (job) => changes.push({ id: job.id, input: { ...job.input } }),
        });

        const job = queue.add({});
        await waitUntil(() => job.input.taskId === "remote-task");
        await queue.touch(job.id);
        expect(changes.at(-1)).toEqual({ id: job.id, input: { taskId: "remote-task" } });
        release();
        await queue.wait(job.id);
    });

    test("releases the worker slot when the running-state callback rejects", async () => {
        let rejectFirstRunningChange = true;
        const queue = new JobQueue<number, number>({
            concurrency: 1,
            worker: async (value) => value,
            onChange: (job) => {
                if (job.status === "running" && rejectFirstRunningChange) {
                    rejectFirstRunningChange = false;
                    throw new Error("temporary persistence failure");
                }
            },
        });

        const first = queue.add(1);
        const second = queue.add(2);
        await expect(queue.wait(first.id)).rejects.toThrow("temporary persistence failure");
        expect(await queue.wait(second.id)).toBe(2);
    });

    test("does not run a job whose initial persistence failed", async () => {
        let executed = false;
        const queue = new JobQueue<number, number>({
            concurrency: 1,
            worker: async (value) => {
                executed = true;
                return value;
            },
            onChange: () => {
                throw new Error("initial persistence failure");
            },
        });

        const job = queue.add(1);
        await expect(queue.wait(job.id)).rejects.toThrow("initial persistence failure");
        expect(executed).toBe(false);
        expect(queue.get(job.id)?.status).toBe("failed");
    });
});

async function waitUntil(predicate: () => boolean) {
    const deadline = Date.now() + 1_000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("等待队列状态超时");
        await Bun.sleep(5);
    }
}

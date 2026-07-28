import { describe, expect, test } from "bun:test";

import { AsyncSemaphore } from "./async-semaphore";

describe("async semaphore", () => {
    test("limits concurrent operations", async () => {
        const semaphore = new AsyncSemaphore(2);
        let active = 0;
        let maximum = 0;

        await Promise.all(
            Array.from({ length: 6 }, (_, index) =>
                semaphore.run(new AbortController().signal, async () => {
                    active += 1;
                    maximum = Math.max(maximum, active);
                    await Bun.sleep(5);
                    active -= 1;
                    return index;
                }),
            ),
        );

        expect(maximum).toBe(2);
    });

    test("removes an aborted waiter without stranding the next operation", async () => {
        const semaphore = new AsyncSemaphore(1);
        let releaseFirst = () => undefined;
        const first = semaphore.run(
            new AbortController().signal,
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve;
                }),
        );
        const waitingController = new AbortController();
        const waiting = semaphore.run(waitingController.signal, async () => "never");
        waitingController.abort();

        await expect(waiting).rejects.toHaveProperty("name", "AbortError");
        releaseFirst();
        await first;
        await expect(semaphore.run(new AbortController().signal, async () => "next")).resolves.toBe("next");
    });

    test("rejects a signal that was already aborted", async () => {
        const semaphore = new AsyncSemaphore(1);
        const controller = new AbortController();
        controller.abort();
        await expect(semaphore.run(controller.signal, async () => "never")).rejects.toHaveProperty("name", "AbortError");
    });
});

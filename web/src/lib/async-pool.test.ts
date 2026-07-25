import { describe, expect, test } from "bun:test";

import { runWithConcurrency } from "./async-pool";

describe("async work pool", () => {
    test("never exceeds the requested concurrency and preserves result order", async () => {
        let active = 0;
        let maximum = 0;
        const results = await runWithConcurrency([30, 10, 20, 5], 2, async (delay, index) => {
            active += 1;
            maximum = Math.max(maximum, active);
            await Bun.sleep(delay);
            active -= 1;
            return index;
        });

        expect(maximum).toBe(2);
        expect(results).toEqual([0, 1, 2, 3]);
    });

    test("uses one worker when the supplied limit is invalid", async () => {
        let active = 0;
        let maximum = 0;
        await runWithConcurrency([1, 2], 0, async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await Bun.sleep(2);
            active -= 1;
        });
        expect(maximum).toBe(1);
    });
});

import { expect, test } from "bun:test";
import { queryVideoTask } from "./query-task";
test("recovers a temporary status-read failure without generating again", async () => {
    let calls = 0;
    const delays: number[] = [];
    const state = await queryVideoTask(async () => { if (++calls < 3) throw new Error("network"); return { status: "completed" }; }, async (ms) => { delays.push(ms); }, () => true);
    expect(state.status).toBe("completed");
    expect(delays).toEqual([1500, 3000]);
});
test("terminal provider results are returned immediately", async () => {
    expect(await queryVideoTask(async () => ({ status: "failed" }), async () => { throw new Error("must not retry"); }, () => true)).toEqual({ status: "failed" });
});
test("limits retries and does not retry authentication errors", async () => {
    let calls = 0;
    await expect(queryVideoTask(async () => { calls++; throw new Error("network"); }, async () => {}, () => true)).rejects.toThrow("network");
    expect(calls).toBe(3);
    calls = 0;
    await expect(queryVideoTask(async () => { calls++; throw new Error("401"); }, async () => {}, () => true)).rejects.toThrow("401");
    expect(calls).toBe(1);
});
test("stops querying when the page or account lifetime ends", async () => {
    let current = true, calls = 0;
    await expect(queryVideoTask(async () => { calls++; throw new Error("network"); }, async () => { current = false; }, () => current)).rejects.toThrow("Aborted");
    expect(calls).toBe(1);
});

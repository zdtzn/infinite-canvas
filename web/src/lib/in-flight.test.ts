import { expect, test } from "bun:test";
import { createInFlightReads } from "./in-flight";

test("shares only concurrent reads for the same user", async () => {
    const reads = createInFlightReads<number>();
    let calls = 0;
    const load = async () => ++calls;
    const first = reads.get("a", load);
    expect(reads.get("a", load)).toBe(first);
    await reads.get("b", load);
    expect(calls).toBe(2);
    await first;
    await reads.get("a", load);
    expect(calls).toBe(3);
});

test("an invalidated read cannot remove a newer request", async () => {
    const reads = createInFlightReads<number>();
    let finishOld!: (value: number) => void;
    let finishNew!: (value: number) => void;
    const old = reads.get(
        "a",
        () =>
            new Promise((resolve) => {
                finishOld = resolve;
            }),
    );
    await Promise.resolve();
    reads.invalidate("a");
    const fresh = reads.get(
        "a",
        () =>
            new Promise((resolve) => {
                finishNew = resolve;
            }),
    );
    await Promise.resolve();
    finishOld(1);
    await old;
    expect(reads.get("a", async () => 3)).toBe(fresh);
    finishNew(2);
    expect(await fresh).toBe(2);
});

test("failed reads can be retried", async () => {
    const reads = createInFlightReads<number>();
    await expect(
        reads.get("a", async () => {
            throw new Error("offline");
        }),
    ).rejects.toThrow("offline");
    expect(await reads.get("a", async () => 42)).toBe(42);
});

import { describe, expect, test } from "bun:test";

import { KeyedSerialExecutor } from "./keyed-serial-executor";

describe("KeyedSerialExecutor", () => {
  test("serializes operations for the same key", async () => {
    const executor = new KeyedSerialExecutor();
    const events: string[] = [];
    let releaseFirst = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = executor.run("job-a", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = executor.run("job-a", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Bun.sleep(1);
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("does not block a different key and releases after errors", async () => {
    const executor = new KeyedSerialExecutor();
    let differentKeyCompleted = false;

    const failing = executor.run("job-a", async () => {
      await Bun.sleep(5);
      throw new Error("failed");
    });
    const different = executor.run("job-b", () => {
      differentKeyCompleted = true;
    });

    await different;
    expect(differentKeyCompleted).toBe(true);
    await expect(failing).rejects.toThrow("failed");
    await expect(executor.run("job-a", () => "released")).resolves.toBe(
      "released",
    );
  });
});

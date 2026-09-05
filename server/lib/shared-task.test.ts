import { expect, test } from "bun:test";
import { createSharedTasks } from "./shared-task";

test("coalesces downloads without sharing cancellation", async () => {
  const tasks = createSharedTasks<string>();
  const first = new AbortController();
  const second = new AbortController();
  let calls = 0;
  let upstream!: AbortSignal;
  let finish!: (value: string) => void;
  const load = (signal: AbortSignal) => {
    calls++;
    upstream = signal;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  const a = tasks.run("image", first.signal, load).catch(() => "canceled");
  const b = tasks.run("image", second.signal, load);
  await Promise.resolve();
  first.abort();
  expect(upstream.aborted).toBe(false);
  finish("original bytes");
  expect(await a).toBe("canceled");
  expect(await b).toBe("original bytes");
  expect(calls).toBe(1);
});

test("aborts abandoned work and permits retry before the old work settles", async () => {
  const tasks = createSharedTasks<string>();
  const controller = new AbortController();
  let upstream!: AbortSignal;
  let finish!: (value: string) => void;
  const old = tasks
    .run("image", controller.signal, (signal) => {
      upstream = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .catch(() => "canceled");
  await Promise.resolve();
  controller.abort();
  expect(upstream.aborted).toBe(true);
  expect(
    await tasks.run("image", new AbortController().signal, async () => "fresh"),
  ).toBe("fresh");
  finish("old");
  expect(await old).toBe("canceled");
});

test("failed shared downloads do not poison subsequent requests", async () => {
  const tasks = createSharedTasks<number>();
  await expect(
    tasks.run("image", new AbortController().signal, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(
    await tasks.run("image", new AbortController().signal, async () => 1),
  ).toBe(1);
});

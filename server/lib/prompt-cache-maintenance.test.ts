import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPromptCacheMaintenance } from "./prompt-cache-maintenance";

test("an unavailable directory does not break startup or later cleanup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "canvas-perf-cache-retry-"));
  const directory = join(parent, "cache");
  const cache = createPromptCacheMaintenance(directory, 0, 0);
  try {
    await cache.prune();
    await mkdir(directory);
    await writeFile(join(directory, "a".repeat(64)), "cached image");
    await cache.prune();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("coalesces cleanup, preserves recent files and enforces count and byte limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-perf-cache-"));
  try {
    const keys = ["a", "b", "c"].map((key) => key.repeat(64));
    for (let index = 0; index < keys.length; index++) {
      await writeFile(join(directory, keys[index]), Buffer.alloc(10, index));
      await writeFile(join(directory, `${keys[index]}.meta.json`), "{}");
      const time = new Date(1000 * (index + 1));
      await utimes(join(directory, `${keys[index]}.meta.json`), time, time);
    }
    const cache = createPromptCacheMaintenance(directory, 2, 15);
    const first = cache.prune();
    expect(cache.prune()).toBe(first);
    await first;
    expect((await readdir(directory)).sort()).toEqual(
      [keys[2], `${keys[2]}.meta.json`].sort(),
    );
    await cache.touch(join(directory, keys[2]));
    expect(
      (await stat(join(directory, `${keys[2]}.meta.json`))).mtimeMs,
    ).toBeGreaterThan(3000);
    await cache.touch(join(directory, "missing"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";

export function createPromptCacheMaintenance(
  directory: string,
  maxEntries: number,
  maxBytes: number,
) {
  let running: Promise<void> | undefined;
  let requested = false;
  const touches = new Map<string, Promise<void>>();

  async function scan() {
    // Preserve best-effort directory scans; deletion failures still propagate.
    const files = (
      await readdir(directory, { withFileTypes: true }).catch(() => [])
    ).filter((entry) => entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name));
    const entries: Array<{
      path: string;
      metadataPath: string;
      bytes: number;
      accessedAt: number;
    }> = [];
    // Bound filesystem concurrency instead of flooding the pool for a full cache.
    for (let offset = 0; offset < files.length; offset += 32) {
      const batch = await Promise.all(
        files.slice(offset, offset + 32).map(async (file) => {
          const path = join(directory, file.name);
          const metadataPath = `${path}.meta.json`;
          try {
            const info = await stat(path);
            const metadata = await stat(metadataPath).catch(() => null);
            return {
              path,
              metadataPath,
              bytes: info.size,
              accessedAt: metadata?.mtimeMs ?? info.mtimeMs,
            };
          } catch {
            return null;
          }
        }),
      );
      for (const entry of batch) if (entry) entries.push(entry);
    }
    entries.sort((a, b) => a.accessedAt - b.accessedAt);
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = entries.length;
    for (const entry of entries) {
      if (count <= maxEntries && total <= maxBytes) break;
      await rm(entry.path, { force: true });
      await rm(entry.metadataPath, { force: true });
      count -= 1;
      total -= entry.bytes;
    }
  }

  return {
    prune() {
      requested = true;
      if (!running) {
        running = (async () => {
          do {
            requested = false;
            await scan();
          } while (requested);
        })().finally(() => {
          running = undefined;
        });
      }
      return running;
    },
    touch(path: string) {
      const existing = touches.get(path);
      if (existing) return existing;
      const now = new Date();
      const task = utimes(`${path}.meta.json`, now, now)
        .catch(() => undefined)
        .finally(() => {
          touches.delete(path);
        });
      touches.set(path, task);
      return task;
    },
  };
}

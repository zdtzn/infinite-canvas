import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../db/database";
import { promptIndexStatuses, queryPromptIndex } from "./prompt-index";
import { createPromptIndexRefresher } from "./prompt-source-refresh";

const source = { id: "source", name: "Test source", githubUrl: "", enabled: true, script: "" };
const prompt = (id: string) => ({ id, title: `Prompt ${id}`, prompt: `Draw a bold poster with ${id}` });

test("failed and incomplete refreshes preserve the last complete index and record the error", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-refresh-"));
  const database = openAppDatabase({ dataDir });
  try {
    let items: unknown[] = [prompt("one"), prompt("two")];
    const refresher = createPromptIndexRefresher(database.raw!, async () => items);
    const before = await refresher.refresh(source);
    expect(before).toMatchObject({ count: 2, success: true, lastError: "" });
    expect(before.lastSuccessAt).toBeTruthy();

    items = [];
    const empty = await refresher.refresh(source);
    expect(empty).toMatchObject({ count: 2, success: false, lastSuccessAt: before.lastSuccessAt });
    expect(empty.lastError).toBeTruthy();

    items = [prompt("partial"), { title: "Missing prompt" }];
    const malformed = await refresher.refresh(source);
    expect(malformed).toMatchObject({ count: 2, success: false, lastSuccessAt: before.lastSuccessAt });
    expect(malformed.lastError).toBeTruthy();
    expect(queryPromptIndex(database.raw!, { sourceId: source.id }).items.map(({ id }) => id).sort()).toEqual(["one", "two"]);

    items = [prompt("new")];
    await expect(refresher.refresh(source)).resolves.toMatchObject({ count: 1, success: true, lastError: "" });
    expect(queryPromptIndex(database.raw!, { sourceId: source.id }).items.map(({ id }) => id)).toEqual(["new"]);
  } finally {
    database.raw?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("single and batch refresh callers share work and old results cannot survive a configuration change", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-refresh-race-"));
  const database = openAppDatabase({ dataDir });
  try {
    const pending = Promise.withResolvers<unknown[]>();
    let calls = 0;
    const refresher = createPromptIndexRefresher(database.raw!, async () => ++calls === 1 ? pending.promise : [prompt("current")]);
    const obsolete = refresher.refresh(source);
    expect(refresher.refresh(source)).toBe(obsolete);
    expect(refresher.isRefreshing(source.id)).toBe(true);
    await Promise.resolve();

    refresher.invalidate(source.id);
    expect(refresher.isRefreshing(source.id)).toBe(false);
    await expect(refresher.refresh(source)).resolves.toMatchObject({ count: 1, success: true });
    pending.resolve([prompt("obsolete")]);
    await expect(obsolete).resolves.toMatchObject({ success: false });
    expect(calls).toBe(2);
    expect(promptIndexStatuses(database.raw!)[0]?.lastError).toBe("");
    expect(queryPromptIndex(database.raw!, { sourceId: source.id }).items.map(({ id }) => id)).toEqual(["current"]);
  } finally {
    database.raw?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

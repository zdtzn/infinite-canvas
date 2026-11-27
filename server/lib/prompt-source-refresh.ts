import type { Database } from "bun:sqlite";

import { AsyncSemaphore } from "./async-semaphore";
import { normalizePromptSourceIndexItems, promptIndexStatuses, recordPromptIndexError, replacePromptIndex } from "./prompt-index";
import type { ManagedPromptSource } from "./prompt-sources";

export type PromptSourceRefreshResult = ReturnType<typeof promptIndexStatuses>[number] & {
  name: string;
  success: boolean;
};

export function createPromptIndexRefresher(
  database: Database,
  loadItems: (source: ManagedPromptSource, signal: AbortSignal) => Promise<unknown>,
  onReplace: (sourceId: string) => void = () => {},
) {
  const semaphore = new AsyncSemaphore(8);
  const inFlight = new Map<string, { controller: AbortController; task: Promise<PromptSourceRefreshResult> }>();

  function result(source: ManagedPromptSource, success: boolean, error?: string): PromptSourceRefreshResult {
    const status = promptIndexStatuses(database).find((item) => item.sourceId === source.id);
    return {
      sourceId: source.id,
      name: source.name,
      success,
      count: status?.count ?? 0,
      lastSuccessAt: status?.lastSuccessAt ?? "",
      lastError: error ?? status?.lastError ?? "",
    };
  }

  function refresh(source: ManagedPromptSource) {
    const existing = inFlight.get(source.id);
    if (existing) return existing.task;
    const controller = new AbortController();
    const signal = controller.signal;
    const task = semaphore.run(signal, () => loadItems(source, signal))
      .then((rawItems) => {
        signal.throwIfAborted();
        const items = normalizePromptSourceIndexItems(source, rawItems);
        if (!items.length) throw new Error("提示词来源未返回有效条目");
        replacePromptIndex(database, source.id, items);
        onReplace(source.id);
        return result(source, true);
      })
      .catch((error: unknown) => {
        if (signal.aborted) return result(source, false, "提示词来源配置已更改，请重新刷新");
        const message = error instanceof Error ? error.message : String(error);
        recordPromptIndexError(database, source.id, message);
        return result(source, false);
      })
      .finally(() => {
        if (inFlight.get(source.id)?.controller === controller) inFlight.delete(source.id);
      });
    inFlight.set(source.id, { controller, task });
    return task;
  }

  function invalidate(sourceId: string) {
    const pending = inFlight.get(sourceId);
    inFlight.delete(sourceId);
    pending?.controller.abort();
  }

  return { refresh, invalidate, isRefreshing: (sourceId: string) => inFlight.has(sourceId) };
}

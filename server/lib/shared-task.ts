/** Share work without letting one disconnected caller cancel the remaining callers. */
export function createSharedTasks<T>() {
  type Entry = {
    controller: AbortController;
    task: Promise<T>;
    users: number;
    settled: boolean;
  };
  const entries = new Map<string, Entry>();
  return {
    run(
      key: string,
      signal: AbortSignal,
      load: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      if (signal.aborted) return Promise.reject(signal.reason);
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        const created: Entry = {
          controller,
          users: 0,
          settled: false,
          task: undefined!,
        };
        created.task = Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return load(controller.signal);
          })
          .finally(() => {
            created.settled = true;
            if (entries.get(key) === created) entries.delete(key);
          });
        entries.set(key, created);
        entry = created;
      }
      const current = entry;
      current.users += 1;
      return new Promise<T>((resolve, reject) => {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          signal.removeEventListener("abort", abort);
          current.users -= 1;
          if (!current.users && !current.settled) {
            if (entries.get(key) === current) entries.delete(key);
            current.controller.abort();
          }
        };
        const abort = () => {
          release();
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        void current.task.then(
          (value) => {
            if (released) return;
            release();
            resolve(value);
          },
          (error) => {
            if (released) return;
            release();
            reject(error);
          },
        );
      });
    },
  };
}

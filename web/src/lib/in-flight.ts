/** Share concurrent reads only; fulfilled data is never retained. */
export function createInFlightReads<T>() {
    const pending = new Map<string, Promise<T>>();
    return {
        get(key: string, load: () => Promise<T>) {
            const existing = pending.get(key);
            if (existing) return existing;
            const request = Promise.resolve()
                .then(load)
                .finally(() => {
                    if (pending.get(key) === request) pending.delete(key);
                });
            pending.set(key, request);
            return request;
        },
        invalidate(key: string) {
            pending.delete(key);
        },
    };
}

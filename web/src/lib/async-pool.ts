export async function runWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit) || 1));
    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            for (;;) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

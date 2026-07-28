type Waiter = {
    resolve: () => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    onAbort: () => void;
};

export class AsyncSemaphore {
    private active = 0;
    private readonly waiters: Waiter[] = [];
    private readonly limit: number;

    constructor(limit: number) {
        this.limit = Math.max(1, Math.floor(limit) || 1);
    }

    async run<T>(signal: AbortSignal, operation: () => Promise<T> | T) {
        await this.acquire(signal);
        try {
            return await operation();
        } finally {
            this.release();
        }
    }

    private async acquire(signal: AbortSignal) {
        if (signal.aborted) throw abortError(signal);
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const waiter = {} as Waiter;
            const onAbort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index < 0) return;
                this.waiters.splice(index, 1);
                signal.removeEventListener("abort", onAbort);
                reject(abortError(signal));
            };
            Object.assign(waiter, { resolve, reject, signal, onAbort });
            this.waiters.push(waiter);
            signal.addEventListener("abort", onAbort, { once: true });

            // The signal can become aborted between the first check and listener registration.
            if (signal.aborted) onAbort();
        });
    }

    private release() {
        const next = this.waiters.shift();
        if (next) {
            next.signal.removeEventListener("abort", next.onAbort);
            next.resolve();
            return;
        }
        this.active = Math.max(0, this.active - 1);
    }
}

function abortError(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

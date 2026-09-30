type AccountSource = {
    getOwner: () => string;
    subscribe: (onChange: () => void) => () => void;
};

// One lifetime per mounted page. Account transitions permanently invalidate old
// work, even when A -> B -> A is batched into a single React render.
export function createColorOperationLifetime(accounts: AccountSource, onOwnerChange?: () => void) {
    let active = true;
    let owner = accounts.getOwner();
    let controller = new AbortController();
    const unsubscribe = accounts.subscribe(() => {
        const nextOwner = accounts.getOwner();
        if (nextOwner === owner) return;
        controller.abort();
        owner = nextOwner;
        controller = new AbortController();
        onOwnerChange?.();
    });
    return {
        capture(expectedOwner: string, ownsDestination: () => boolean = () => true) {
            const signal = controller.signal;
            const isCurrent = () => active && !signal.aborted && accounts.getOwner() === expectedOwner && ownsDestination();
            return isCurrent() ? { ownerId: expectedOwner, signal, isCurrent } : null;
        },
        dispose() {
            active = false;
            controller.abort();
            unsubscribe();
        },
    };
}

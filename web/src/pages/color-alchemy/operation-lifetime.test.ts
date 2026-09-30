import { expect, test } from "bun:test";
import { createColorOperationLifetime } from "./operation-lifetime";

function setup(owner = "a") {
    const listeners = new Set<() => void>();
    const accounts = { getOwner: () => owner, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const lifetime = createColorOperationLifetime(accounts);
    return { lifetime, listeners, change: (next: string) => { owner = next; listeners.forEach((listener) => listener()); } };
}
test("account transitions abort old work permanently while allowing fresh same-owner work", () => {
    const f = setup();
    const old = f.lifetime.capture("a")!;
    f.change("b");
    expect(old.signal.aborted).toBe(true);
    f.change("a");
    expect(old.isCurrent()).toBe(false);
    expect(f.lifetime.capture("a")!.isCurrent()).toBe(true);
    expect(f.lifetime.capture("b")).toBeNull();
    f.lifetime.dispose();
});
test("unmount releases subscriptions and prevents old or new work", () => {
    const f = setup();
    const operation = f.lifetime.capture("a")!;
    f.lifetime.dispose();
    expect(operation.signal.aborted).toBe(true);
    expect(operation.isCurrent()).toBe(false);
    expect(f.lifetime.capture("a")).toBeNull();
    expect(f.listeners.size).toBe(0);
});
test("profile updates and local mode remain usable; mismatched destination stores do not", () => {
    const f = setup("");
    const operation = f.lifetime.capture("")!;
    f.change("");
    expect(operation.isCurrent()).toBe(true);
    let ownsDestination = true;
    const guarded = f.lifetime.capture("", () => ownsDestination)!;
    ownsDestination = false;
    expect(guarded.isCurrent()).toBe(false);
    expect(f.lifetime.capture("", () => false)).toBeNull();
    f.lifetime.dispose();
});

test("batched account transitions synchronously reset page bookkeeping", () => {
    let owner = "a";
    let changed!: () => void;
    let busy = true;
    const tasks = new Map([["draft", Promise.resolve()]]);
    const lifetime = createColorOperationLifetime({ getOwner: () => owner, subscribe: (listener) => { changed = listener; return () => {}; } }, () => { busy = false; tasks.clear(); });
    const old = lifetime.capture("a")!;
    owner = "b";
    changed();
    owner = "a";
    changed();
    expect(old.isCurrent()).toBe(false);
    expect(busy).toBe(false);
    expect(tasks.size).toBe(0);
    lifetime.dispose();
});

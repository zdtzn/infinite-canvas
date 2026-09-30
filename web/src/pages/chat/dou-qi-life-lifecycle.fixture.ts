import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import * as React from "react";

// Isolated hook dispatcher: exercise real async handlers without installing a DOM runtime.
let slots: any[] = [], cursor = 0, dirty = false, account = "alice";
let effects: Array<{ index: number; effect: () => unknown }> = [];
const dependencies = new Map<number, any[]>(), cleanups = new Map<number, any>();
const storage = new Map<string, string>();
Object.assign(globalThis, { window: { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } } });
(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }]; },
    useRef(value: any) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(effect: () => unknown, deps: any[]) { const index = cursor++, previous = dependencies.get(index); if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { dependencies.set(index, deps); effects.push({ index, effect }); } },
};
let api: Record<string, (...args: any[]) => any> = {};
const names = ["createDouQiLifeSession", "deleteDouQiLifeSave", "deleteDouQiLifeSession", "fetchDouQiLifeSavePreview", "fetchDouQiLifeSaves", "fetchDouQiLifeSession", "fetchDouQiLifeSessions", "renameDouQiLifeSave", "restoreDouQiLifeSave", "saveDouQiLifeSession", "sendDouQiLifeTurn"];
mock.module("../../services/dou-qi-life-api", () => Object.fromEntries(names.map((name) => [name, (...args: any[]) => api[name](...args)])));
mock.module("../../stores/use-user-store", () => ({ useUserStore: { getState: () => ({ user: { id: account } }) } }));
const { useDouQiLife } = await import("./use-dou-qi-life");
let view: ReturnType<typeof useDouQiLife>;
const notice = { error() {}, success() {}, info() {} };
const session = (id: string) => ({ id, title: id, status: "active", state: { world: { location: "青山镇" }, player: { name: id }, memory: {} } });
const first = session("A"), second = session("B");
const save = (id: string) => ({ id: `save-${id}`, sessionId: id, kind: "manual", title: id });
const player = { id: "p", role: "player", content: "观察", status: "completed", metadata: {} };
const world = { id: "w", role: "world", content: "", status: "streaming", metadata: {} };
const started = { session: first, playerMessage: player, worldMessage: world };
function render() { cursor = 0; dirty = false; view = useDouQiLife(account, notice); }
async function flush() { for (let i = 0; i < 10; i++) { if (dirty) render(); const pending = effects; effects = []; for (const { index, effect } of pending) { cleanups.get(index)?.(); cleanups.set(index, effect()); } await new Promise<void>((resolve) => setImmediate(resolve)); } if (dirty) render(); }
function reset() { for (const cleanup of cleanups.values()) cleanup?.(); slots = []; cursor = 0; dirty = false; effects = []; dependencies.clear(); cleanups.clear(); storage.clear(); account = "alice"; api = { fetchDouQiLifeSessions: async () => ({ items: [first, second] }), fetchDouQiLifeSession: async (id) => ({ session: session(id), messages: [] }), fetchDouQiLifeSaves: async (id) => ({ items: [save(id)] }) }; }
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>((done) => { resolve = done; }); return { promise, resolve }; }

reset(); api.fetchDouQiLifeSessions = async () => { throw new Error("网络离线"); }; render(); await flush();
assert.equal(view!.phase, "error"); assert.equal(view!.error, "网络离线");
api.fetchDouQiLifeSessions = async () => ({ items: [first] }); await view!.retryLoad(); await flush(); assert.equal(view!.phase, "world");

reset(); render(); await flush();
api.sendDouQiLifeTurn = async (_id, _action, handler) => { handler.onStarted(started); handler.onDelta({ messageId: "w", delta: "山路" }); throw new Error("断线"); };
await view!.send("观察"); await flush(); assert.equal(view!.messages.at(-1)?.status, "failed"); assert.equal(view!.messages.at(-1)?.content, "山路"); assert.equal(view!.sending, false); assert.equal(view!.draft, "观察");

reset(); render(); await flush();
api.fetchDouQiLifeSession = async () => ({ session: first, messages: [player, { ...world, content: "已经结算", status: "completed" }] });
api.sendDouQiLifeTurn = async (_id, _action, handler) => { handler.onStarted(started); throw new Error("终止事件丢失"); };
await view!.send("观察"); await flush(); assert.equal(view!.messages.at(-1)?.status, "completed"); assert.equal(view!.messages.at(-1)?.content, "已经结算");

reset(); render(); await flush(); const late = deferred();
api.fetchDouQiLifeSaves = async (id) => id === "A" ? late.promise : ({ items: [save(id)] });
api.sendDouQiLifeTurn = async (_id, _action, handler) => { handler.onStarted(started); handler.onDone({ session: first, worldMessage: { ...world, status: "completed" }, suggestions: [] }); };
await view!.send("观察"); await flush(); await view!.loadSession("B"); await flush(); late.resolve({ items: [save("A")] }); await flush(); assert.equal(view!.activeSession?.id, "B"); assert.equal(view!.saves[0].sessionId, "B");

reset(); render(); await flush(); let requests = 0, captured: any;
api.sendDouQiLifeTurn = (_id, _action, handler) => { requests++; captured = handler; handler.onStarted(started); return new Promise((_done, reject) => handler.signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError")))); };
void view!.send("观察"); void view!.send("重复提交"); await flush(); assert.equal(requests, 1); view!.setDraft("下一步"); await flush(); view!.stopTurn(); await flush(); assert.equal(captured.signal.aborted, true); assert.equal(view!.sending, false); assert.equal(view!.draft, "下一步"); assert.equal(view!.messages.at(-1)?.status, "failed");

reset(); render(); await flush(); const oldCreate = deferred(); api.createDouQiLifeSession = () => oldCreate.promise;
void view!.createLife({ name: "old" }); account = "bob"; api.fetchDouQiLifeSessions = async () => ({ items: [] }); api.fetchDouQiLifeSaves = async () => ({ items: [] }); render(); await flush(); oldCreate.resolve({ session: first }); await flush(); assert.equal(view!.phase, "welcome"); assert.equal(view!.activeSession, null); assert.equal(view!.sessions.length, 0);

reset(); storage.set("douqi:alice:session", "B"); render(); await flush(); assert.equal((view! as ReturnType<typeof useDouQiLife>).activeSession?.id, "B");
const latePreview = deferred(); api.fetchDouQiLifeSavePreview = () => latePreview.promise; void view!.openPreview("save-B"); await flush(); view!.closePreview(); latePreview.resolve({ save: save("B"), state: second.state }); await flush(); assert.equal(view!.preview, null); assert.equal(view!.previewId, "");
for (const cleanup of cleanups.values()) cleanup?.();
console.log("lifecycle regressions passed: load recovery, disconnect, stale saves, stop/draft/double send, account isolation, resume, stale preview");

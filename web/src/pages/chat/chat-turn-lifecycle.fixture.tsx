import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import * as React from "react";
import { chatDraftKey, createChatDraftRepository } from "./chat-draft-storage";

// Run the real page closures in a child process, isolated from suite-wide antd mocks.
let slots: any[] = [], cursor = 0, dirty = false, account = "alice", mounted = true, lateWrites = 0;
let effects: Array<{ index: number; effect: () => any }> = [];
const dependencies = new Map<number, any[]>(), cleanups = new Map<number, any>();
const storage = new Map<string, string>();
const draftValues = new Map<string, unknown>();
const draftStorage = { async getItem(key: string) { return draftValues.get(key); }, async setItem(key: string, value: unknown) { draftValues.set(key, value); }, async removeItem(key: string) { draftValues.delete(key); } };
let draftRepository = createChatDraftRepository(draftStorage);
Object.assign(globalThis, {
    window: { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, setTimeout, clearTimeout },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
});
function effect(effect: () => any, deps: any[]) {
    const index = cursor++, previous = dependencies.get(index);
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { dependencies.set(index, deps); effects.push({ index, effect }); }
}
(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { if (!mounted) lateWrites++; slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }]; },
    useRef(value: any) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect: effect, useLayoutEffect: effect,
    useCallback(callback: any) { cursor++; return callback; },
};
let api: Record<string, (...args: any[]) => any> = {}, runtime: any, initial: any[] = [], rows: any[] = [], sent: any[] = [];
const notice = { error() {}, info() {}, warning() {}, success() {} }, app = { message: notice, modal: {} };
class ChatRequestError extends Error { rejected = true; status = 503; }
const apiNames = ["cancelChatMessage", "createChatConversation", "createChatMemory", "deleteChatConversation", "deleteChatMemory", "fetchChatConversation", "fetchChatConversationExport", "fetchChatTurn", "importChatConversation", "sendChatMessage", "truncateChatMessages", "updateChatConversationPreset", "updateChatMemory", "uploadChatImage"];
mock.module("../../services/chat-api", () => ({ ChatRequestError, ...Object.fromEntries(apiNames.map((name) => [name, (...args: any[]) => api[name](...args)])) }));
mock.module("antd", () => ({ App: { useApp: () => app }, Button: "test-button", Drawer: "test-drawer", Dropdown: "test-dropdown", Empty: Object.assign(() => null, { PRESENTED_IMAGE_SIMPLE: "empty" }), Input: { TextArea: "test-textarea" }, Popconfirm: "test-popconfirm", Segmented: "test-segmented", Skeleton: "test-skeleton", Tag: "test-tag", Tooltip: "test-tooltip" }));
mock.module("../../stores/use-user-store", () => ({ useUserStore: Object.assign((select: any) => select({ user: { id: account } }), { getState: () => ({ user: { id: account } }), subscribe: () => () => {} }) }));
mock.module("../../stores/use-chat-runtime-store", () => ({ useChatRuntimeStore: Object.assign((select: any) => select(runtime), { getState: () => runtime }) }));
mock.module("../../stores/use-canvas-context-store", () => ({ useCanvasContextStore: (select: any) => select({ snapshot: null, clear() {} }) }));
mock.module("../../services/server-api", () => ({ saveServerUserPreferences: async () => {} }));
mock.module("../../services/chat-bootstrap-cache", () => ({ clearChatBootstrapCache() {}, getChatBootstrapRequests: () => ({ preferences: Promise.resolve({}), conversations: Promise.resolve({ items: rows }), memories: Promise.resolve({ items: [] }), firstConversation: Promise.resolve(rows[0] ? { conversation: rows[0], messages: initial } : null) }) }));
mock.module("../../lib/lazy-route", () => ({ lazyRoute: () => () => null }));
mock.module("./use-chat-draft", () => ({ useChatDraft(userId: string, conversationId: string) {
    const key = chatDraftKey(userId, conversationId), repository = draftRepository;
    React.useEffect(() => { const unsubscribe = repository.subscribe(key, () => { dirty = true; }); void repository.load(key); return unsubscribe; }, [key, repository]);
    const snapshot = repository.getSnapshot(key);
    return { ...snapshot, setDraft: (value: any) => repository.setDraft(key, value), setAttachments: (value: any) => repository.setAttachments(key, value), clearDraft: () => repository.clear(key, snapshot.revision), moveDraft: (targetId: string) => repository.move(key, chatDraftKey(userId, targetId), snapshot.revision) };
} }));
const { default: ChatPage, ChatBubble } = await import("./index");
let tree: any;
function render() { cursor = 0; dirty = false; tree = ChatPage(); }
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); }
async function flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); const pending = effects; effects = []; for (const { index, effect } of pending) { cleanups.get(index)?.(); cleanups.set(index, effect()); } await settle(); } if (dirty) render(); }
function all(node = tree): any[] { if (!node) return []; if (Array.isArray(node)) return node.flatMap(all); if (typeof node !== "object") return []; return [node, ...(node.props?.children === undefined ? [] : all(node.props.children))]; }
const text = (node: any): string => node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const bubbles = () => all().filter((node) => node.type === ChatBubble).map((node) => node.props);
const composer = () => all().find((node) => node.props?.["aria-label"] === "问道内容");
const button = (label: string) => all().find((node) => node.type === "test-button" && text(node) === label);
async function write(value: string) { composer().props.onChange({ target: { value } }); await flush(); }
async function send() { button("发送").props.onClick(); await flush(); }
function deferred() { let resolve!: (value?: any) => void, reject!: (error: any) => void; const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const conversation = (id: string) => ({ id, title: `会话${id}`, presetId: "", channelId: "", model: "", createdAt: 1, updatedAt: 1 });
const message = (id: string, role: string, content: string, extra = {}) => ({ id, conversationId: "A", role, content, attachments: [], status: "completed", error: "", createdAt: role === "user" ? 1 : 2, updatedAt: 2, ...extra });
function started(input: any, status = "streaming") {
    const mutation = input.retryAssistantMessageId || input.editUserMessageId || input.continueAssistantMessageId;
    return { conversation: conversation("A"), userMessage: message(mutation ? input.editUserMessageId || "u" : input.clientMessageId || "u", "user", input.content || "原问题", { attachments: input.attachments }), assistantMessage: message(input.retryAssistantMessageId || input.continueAssistantMessageId || "a", "assistant", status === "completed" ? "完成回答" : "", { status }) };
}
function unmount() { mounted = false; for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); }
async function reset(messages: any[] = [], conversations = [conversation("A"), conversation("B")]) {
    unmount(); slots = []; cursor = 0; dirty = false; effects = []; dependencies.clear(); storage.clear(); draftValues.clear(); draftRepository = createChatDraftRepository(draftStorage); mounted = true; account = "alice"; initial = messages; rows = conversations; sent = []; lateWrites = 0;
    runtime = { pending: false, status: "idle", userId: "", turnId: "", conversationId: "", setRuntime(patch: any) { Object.assign(runtime, patch); dirty = true; }, clearRuntime(id?: string, turnId?: string) { if (id && id !== runtime.conversationId || turnId && turnId !== runtime.turnId) return; Object.assign(runtime, { pending: false, status: "idle", conversationId: "", turnId: "", userId: "" }); dirty = true; } };
    api = {
        fetchChatConversation: async (id) => ({ conversation: conversation(id), messages: id === "A" ? initial : [message("b", "user", "B的问题", { conversationId: "B" })] }),
        fetchChatConversationExport: async (id) => ({ conversation: conversation(id), messages: initial }),
        fetchChatTurn: async () => ({ turn: null }), createChatConversation: async () => ({ conversation: conversation("A") }), cancelChatMessage: async () => ({}),
        uploadChatImage: async () => ({ assetKey: "asset", mimeType: "image/png", name: "图片", url: "/asset" }),
        sendChatMessage: async (input) => { sent.push(input); throw new ChatRequestError("暂时不可用"); },
    };
    render(); await flush();
}

await reset(); await write("带附件的问题");
const upload = all().find((node) => node.type === "input" && node.props.accept === "image/*");
upload.props.onChange({ target: { files: [new File(["x"], "x.png", { type: "image/png" })] } }); await flush();
const remove = all().find((node) => node.props?.["aria-label"] === "移除图片");
assert.match(remove.props.className, /size-11/); assert.match(remove.props.className, /group-focus-within:opacity-100/); assert(!remove.props.className.split(" ").includes("opacity-0"));
await send(); const failed = bubbles().at(-1); assert.equal(failed.item.isOptimistic, true);
assert.equal(composer().props.value, "带附件的问题"); assert(all().some((node) => node.props?.["aria-label"] === "移除图片"));
api.sendChatMessage = async (input) => { sent.push(input); const turn = started(input); input.onStarted(turn); input.onDone({ conversation: turn.conversation, message: { ...turn.assistantMessage, status: "completed", content: "成功" } }); };
failed.onAction("retry", failed.item); await flush();
assert.equal(sent.length, 2); assert.equal(sent[0].clientMessageId, sent[1].clientMessageId); assert.equal(sent[1].content, "带附件的问题"); assert.equal(sent[1].attachments[0].assetKey, "asset"); assert.equal(bubbles().at(-1).item.content, "成功");
assert.equal(composer().props.value, "");

await reset(); await write("A的草稿");
all().find((node) => node.type === "input" && node.props.accept === "image/*").props.onChange({ target: { files: [new File(["x"], "x.png", { type: "image/png" })] } }); await flush();
all().find((node) => node.type === "button" && text(node).includes("会话B")).props.onClick(); await flush();
assert.equal(composer().props.value, ""); assert(!all().some((node) => node.props?.["aria-label"] === "移除图片"));
await write("B的草稿"); all().find((node) => node.type === "button" && text(node).includes("会话A")).props.onClick(); await flush();
assert.equal(composer().props.value, "A的草稿"); assert(all().some((node) => node.props?.["aria-label"] === "移除图片"));

await reset(); await write("确认前保留"); const acceptedLater = deferred();
api.sendChatMessage = (input) => { sent.push(input); return acceptedLater.promise; }; await send(); assert.equal(composer().props.value, "确认前保留");
all().find((node) => node.type === "button" && text(node).includes("会话B")).props.onClick(); await flush(); await write("另一会话的新草稿");
sent[0].onStarted(started(sent[0])); sent[0].onDone({ conversation: conversation("A"), message: message("a", "assistant", "完成") }); acceptedLater.resolve(); await flush();
assert.equal(composer().props.value, "另一会话的新草稿");
all().find((node) => node.type === "button" && text(node).includes("会话A")).props.onClick(); await flush(); assert.equal(composer().props.value, "");

await reset(); await write("启动失败已落库");
api.fetchChatTurn = async () => ({ turn: { ...started(sent[0]), assistantMessage: message("persisted-failed", "assistant", "", { status: "failed", error: "启动失败" }) } });
await send(); assert.equal(bubbles().at(-1).item.id, "persisted-failed"); assert.equal(bubbles().at(-1).item.isOptimistic, undefined);
api.sendChatMessage = async (input) => { sent.push(input); const turn = started(input); input.onStarted(turn); input.onDone({ conversation: turn.conversation, message: { ...turn.assistantMessage, status: "completed", content: "重试成功" } }); };
const persistedFailure = bubbles().at(-1); persistedFailure.onAction("retry", persistedFailure.item); await flush();
assert.equal(sent[1].retryAssistantMessageId, "persisted-failed"); assert.equal(bubbles().at(-1).item.content, "重试成功");

await reset(); await write("未知送达");
api.sendChatMessage = async (input) => { sent.push(input); throw Error("连接丢失"); }; await send();
const unknown = bubbles().at(-1); assert.equal(unknown.item.status, "failed");
let lookups = 0; api.fetchChatTurn = async () => { lookups++; return { turn: started(sent[0], "completed") }; };
unknown.onAction("retry", unknown.item); await flush();
assert.equal(lookups, 1); assert.equal(sent.length, 1); assert.equal(bubbles().at(-1).item.content, "完成回答");

await reset(); await write("断线后继续"); const recovery = deferred();
api.fetchChatTurn = () => recovery.promise;
api.sendChatMessage = async (input) => { sent.push(input); input.onStarted(started(input)); input.onDelta({ messageId: "a", delta: "已收到" }); throw Error("断线"); };
await send(); assert.equal(runtime.status, "recovering"); assert.equal(runtime.pending, true); assert.equal(bubbles().at(-1).item.status, "streaming"); assert.equal(bubbles().at(-1).item.content, "已收到");
all().find((node) => node.type === "button" && text(node).includes("会话B")).props.onClick(); await flush();
recovery.resolve({ turn: started(sent[0], "completed") }); await flush();
assert.equal(runtime.pending, false); assert.equal(bubbles().at(-1).item.id, "b");

const oldUser = message("u", "user", "原问题"), oldAnswer = message("a", "assistant", "原回答");
await reset([oldUser, oldAnswer]); await write("编辑前的普通草稿");
bubbles()[0].onAction("edit", oldUser); await flush(); await write("尚未保存的编辑");
button("取消编辑").props.onClick(); await flush(); assert.equal(composer().props.value, "编辑前的普通草稿");
bubbles()[0].onAction("edit", oldUser); await flush(); await write("编辑成功的问题");
api.sendChatMessage = async (input) => { sent.push(input); const turn = started(input); input.onStarted(turn); input.onDone({ conversation: turn.conversation, message: { ...turn.assistantMessage, status: "completed" } }); };
button("保存并重答").props.onClick(); await flush(); assert.equal(composer().props.value, "编辑前的普通草稿");

await reset([oldUser, oldAnswer]);
bubbles()[0].onAction("edit", oldUser); await flush(); await write("修改问题");
const editRequest = deferred(); api.sendChatMessage = () => editRequest.promise;
button("保存并重答").props.onClick(); await flush(); assert.deepEqual(bubbles().map((item) => item.item.content), ["原问题", "原回答"]);
editRequest.reject(new ChatRequestError("额度不足")); await flush(); assert.deepEqual(bubbles().map((item) => item.item.content), ["原问题", "原回答"]); assert.equal(composer().props.value, "修改问题");
button("取消编辑").props.onClick(); await flush();
const retryRequest = deferred(); api.sendChatMessage = () => retryRequest.promise;
bubbles().at(-1).onAction("retry", oldAnswer); await flush(); assert.equal(bubbles().at(-1).item.content, "原回答");
retryRequest.reject(new ChatRequestError("额度不足")); await flush(); assert.equal(bubbles().at(-1).item.content, "原回答"); assert.equal(bubbles().at(-1).item.status, "completed");

await reset([oldUser, oldAnswer]); let mutationLookup = "";
api.sendChatMessage = async (input) => { sent.push(input); throw Error("重试已提交但响应丢失"); };
api.fetchChatTurn = async (conversationId, operationId) => {
    assert.equal(conversationId, "A"); assert.equal(operationId, sent[0].clientMessageId); assert.notEqual(operationId, oldUser.id);
    mutationLookup = operationId;
    return { turn: { conversation: conversation("A"), userMessage: oldUser, assistantMessage: { ...oldAnswer } } };
};
bubbles().at(-1).onAction("retry", oldAnswer); await flush();
assert(mutationLookup); assert.equal(sent.length, 1); assert.equal(runtime.pending, false);
assert.deepEqual(bubbles().map((item) => item.item.id), ["u", "a"]); assert.equal(bubbles().at(-1).item.content, "原回答");

await reset(); await write("上传期间回车"); const uploading = deferred(); api.uploadChatImage = () => uploading.promise;
all().find((node) => node.type === "input" && node.props.accept === "image/*").props.onChange({ target: { files: [new File(["x"], "x.png", { type: "image/png" })] } });
composer().props.onPressEnter({ shiftKey: false, preventDefault() {} }); await flush(); assert.equal(sent.length, 0);
uploading.resolve({ assetKey: "asset", mimeType: "image/png", name: "图" }); await flush();

await reset([oldUser, { ...oldAnswer, status: "streaming" }]); await write("历史回答仍生成");
composer().props.onPressEnter({ shiftKey: false, preventDefault() {} }); await flush(); assert.equal(sent.length, 0);

await reset(); await write("恢复时停止"); const stopping = deferred(); api.fetchChatTurn = () => stopping.promise;
api.sendChatMessage = async (input) => { sent.push(input); input.onStarted(started(input)); throw Error("断线"); }; await send();
button("停止").props.onClick(); await flush(); assert.equal(runtime.pending, false); assert.equal(bubbles().at(-1).item.error, "本次回答已停止");
await write("停止后可以继续"); assert.equal(button("发送").props.disabled, false);
stopping.resolve({ turn: started(sent[0], "completed") }); await flush(); assert.equal(bubbles().at(-1).item.error, "本次回答已停止");

await reset([], []); await write("首次发送"); const creating = deferred(); let creations = 0;
api.createChatConversation = () => { creations++; return creating.promise; };
composer().props.onPressEnter({ shiftKey: false, preventDefault() {} }); composer().props.onPressEnter({ shiftKey: false, preventDefault() {} }); await flush();
button("新建").props.onClick(); await flush(); assert.equal(creations, 1);
creating.resolve({ conversation: conversation("A") }); await flush(); assert.equal(sent.length, 1);

await reset([], []); await write("首条提交内容"); const createForDraft = deferred(), firstSend = deferred();
api.createChatConversation = () => createForDraft.promise;
api.sendChatMessage = (input) => { sent.push(input); return firstSend.promise; };
composer().props.onPressEnter({ shiftKey: false, preventDefault() {} }); await flush(); await write("创建会话期间的新草稿");
createForDraft.resolve({ conversation: conversation("A") }); await flush(); assert.equal(sent[0].content, "首条提交内容"); assert.equal(composer().props.value, "创建会话期间的新草稿");
sent[0].onStarted(started(sent[0])); sent[0].onDone({ conversation: conversation("A"), message: message("a", "assistant", "已完成") }); firstSend.resolve(); await flush();
assert.equal(composer().props.value, "创建会话期间的新草稿");

await reset(); await write("旧账户请求"); const oldRequest = deferred(); api.sendChatMessage = (input) => { sent.push(input); return oldRequest.promise; };
await send(); account = "bob"; render(); await flush();
sent[0].onStarted(started(sent[0])); sent[0].onDone({ conversation: conversation("A"), message: message("old", "assistant", "旧账户回答") }); oldRequest.resolve(); await flush();
assert(!bubbles().some((item) => item.item.id === "old")); assert.equal(runtime.pending, false);

await reset(); await write("卸载后仍恢复"); const detached = deferred(); api.fetchChatTurn = () => detached.promise;
api.sendChatMessage = async (input) => { sent.push(input); input.onStarted(started(input)); throw Error("断线"); }; await send();
unmount(); detached.resolve({ turn: started(sent[0], "completed") }); for (let i = 0; i < 8; i++) await settle();
assert.equal(lateWrites, 0); assert.equal(runtime.pending, false);
console.log("chat lifecycle regressions passed: retry payload, unknown reconciliation, recovery, switch, edit/regenerate rejection, upload Enter, create race, account and unmount isolation");

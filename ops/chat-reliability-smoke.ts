import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openAppDatabase } from "../server/db/database";
import { hashAccessCode } from "../server/lib/auth";
import { encryptSecret } from "../server/lib/crypto-store";
import { createChatService } from "../server/modules/chat/service";

// Fresh fixtures only. Every child-process fetch is intercepted; no SMTP or real model requests.
const dataDir = mkdtempSync(join(tmpdir(), "canvas-chat-smoke-"));
const db = openAppDatabase({ dataDir });
const state = db.loadState();
const password = "ChatSmokePassword8391!";
state.auth.accessCodeHash = await hashAccessCode("ChatSmokeAccess8391!");
state.auth.adminUserId = "admin";
for (const id of ["admin", "member"]) state.users[id] = { userId: id, displayName: `Smoke-${id}`, createdAt: 1, admin: id === "admin", loginHash: await hashAccessCode(password) };
state.channels["admin:fixture"] = {
    id: "fixture", userId: "admin", name: "Isolated chat fixture", baseUrl: "https://8.8.8.8", apiFormat: "openai",
    apiKey: encryptSecret("fixture-key", state.auth.sessionSecret), updatedAt: 1, models: [{ name: "text-model", capability: "text" }],
};
db.saveState(state);
const history = createChatService(db.raw!).createConversation("member", { title: "超过千条的历史" });
const ids = Array.from({ length: 1206 }, (_, index) => `history-message-${index}`);
db.raw!.transaction(() => {
    const insert = db.raw!.query("INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, status, created_at, updated_at) VALUES ('member', ?, ?, ?, ?, 'completed', 1, 1)");
    for (const [index, id] of ids.entries()) insert.run(id, history.id, index % 2 ? "assistant" : "user", `历史消息 ${index}`);
})();
const callsPath = join(dataDir, "calls.jsonl");
await Bun.write(callsPath, "");
const entryPath = join(dataDir, "fixture-server.ts");
await Bun.write(entryPath, `
import { appendFileSync, existsSync } from "node:fs";
let count = 0;
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "8.8.8.8" || !url.pathname.endsWith("/responses")) {
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ blocked: true, url: url.href }) + "\\n");
        throw new Error("Outbound request blocked by chat smoke fixture");
    }
    const number = ++count;
    appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ number, path: url.pathname }) + "\\n");
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "response.output_text.delta", delta: "fixture-answer-" + number }) + "\\n\\n"));
        const timer = setInterval(() => {
            if (!existsSync(${JSON.stringify(join(dataDir, "release-"))} + number)) return;
            clearInterval(timer);
            controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "response.completed" }) + "\\n\\n"));
            controller.close();
        }, 20);
    } }), { headers: { "content-type": "text/event-stream" } });
};
await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dir, "../server/index.ts")).href)});
`);
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);
const base = `http://127.0.0.1:${port}`;
const child = Bun.spawn([process.execPath, "run", entryPath], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: resolve(import.meta.dir, "../web/dist"), PUBLIC_BASE_URL: base, FORCE_SECURE_COOKIES: "0", APP_ENCRYPTION_KEY: "", ALLOW_NEW_USERS: "0", SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0", CHAT_USER_CONCURRENCY: "1", CHAT_GLOBAL_CONCURRENCY: "1", CHAT_RATE_LIMIT: "60", CHAT_DAILY_LIMIT: "20", PROMPT_OPTIMIZE_CHANNEL_ID: "fixture", PROMPT_OPTIMIZE_MODEL: "text-model" },
    stdout: "ignore", stderr: "pipe",
});
const get = (path: string, cookie = "") => fetch(base + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
const post = (path: string, body: unknown, cookie = "") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
const calls = () => readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map(value => JSON.parse(value));
const json = async (response: Response, status = 200) => {
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
};
try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { if ((await get("/health")).ok) { ready = true; break; } } catch {}
        await Bun.sleep(100);
    }
    assert(ready, "isolated server ready");
    const login = async (id: string) => {
        const response = await post("/api/auth/login", { displayName: `Smoke-${id}`, personalCode: password });
        assert.equal(response.status, 200, await response.clone().text());
        return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    };
    const cookie = await login("member");
    const adminCookie = await login("admin");
    const path = `/api/chat/conversations/${history.id}`;
    assert.equal((await get(path)).status, 401);
    assert.equal((await get(path, adminCookie)).status, 404);
    let page = await json(await get(path, cookie));
    assert.deepEqual(page.messages.map((message: { id: string }) => message.id), ids.slice(-100));
    const loaded = [...page.messages];
    while (page.hasMore) {
        page = await json(await get(`${path}?before=${encodeURIComponent(page.nextBefore)}`, cookie));
        loaded.unshift(...page.messages);
    }
    assert.deepEqual(loaded.map(message => message.id), ids);
    assert.equal((await get(`${path}?before=bad-cursor`, cookie)).status, 400);
    assert.equal((await get(`${path}?limit=201`, cookie)).status, 400);
    const lookup = await json(await get(`${path}/turns/${ids[1204]}`, cookie));
    assert.equal(lookup.turn.assistantMessage.id, ids[1205]);
    assert.equal((await get(`${path}/turns/${ids[1204]}`, adminCookie)).status, 404);
    const exported = await json(await get(`${path}/export`, cookie));
    assert.equal(exported.format, "infinite-canvas.chat");
    assert.deepEqual(exported.messages.map((message: { id: string }) => message.id), ids);
    assert.equal((await get(`${path}/export`, adminCookie)).status, 404);
    const account = await json(await get("/api/account/export", cookie));
    assert.equal(account.conversations.find((item: { conversation: { id: string } }) => item.conversation.id === history.id).messages.length, ids.length);
    console.log("PASS: HTTP latest/history pagination over 1206 tied timestamps, turn lookup, full conversation/account export, validation and account isolation");

    const conversation = (await json(await post("/api/chat/conversations", {}, cookie), 201)).conversation;
    const messagePath = `/api/chat/conversations/${conversation.id}/messages`;
    const usage = async () => (await json(await get("/api/chat/usage", cookie))).usage.usedToday;
    const run = async (input: Record<string, unknown>, expectedUsage: number) => {
        const countBefore = calls().length;
        const original = await post(messagePath, { attachments: [], ...input }, cookie);
        assert.equal(original.status, 200);
        const turn = (await json(await get(`/api/chat/conversations/${conversation.id}/turns/${input.clientMessageId}`, cookie))).turn;
        assert.equal(turn.assistantMessage.status, "streaming");
        assert.equal((await post(messagePath, { attachments: [], ...input, clientMessageId: `${input.clientMessageId}-parallel` }, cookie)).status, 429, "a distinct request confirms that the concurrency slot is occupied");
        const duplicate = await post(messagePath, { attachments: [], ...input }, cookie);
        assert.equal(duplicate.status, 200, "accepted duplicate bypasses the occupied concurrency slot");
        const replay = await duplicate.text();
        assert(replay.includes("event: started"));
        assert(replay.includes(turn.assistantMessage.id));
        assert(!replay.includes("event: done"), "streaming replay leaves completion to polling");
        assert.equal(calls().length, countBefore + 1, "one upstream call per intent");
        assert.equal(await usage(), expectedUsage, "one quota reservation per intent");
        const changed = input.continueAssistantMessageId ? { ...input, continueAssistantMessageId: "changed-assistant-target" } : { ...input, content: "changed payload" };
        assert.equal((await post(messagePath, { attachments: [], ...changed }, cookie)).status, 409);
        await Bun.write(join(dataDir, `release-${calls().length}`), "release");
        assert((await original.text()).includes("event: done"));
        const completedReplay = await post(messagePath, { attachments: [], ...input }, cookie);
        assert.equal(completedReplay.status, 200);
        assert((await completedReplay.text()).includes("event: done"));
        assert.equal(calls().length, countBefore + 1);
        assert.equal(await usage(), expectedUsage);
        return (await json(await get(`/api/chat/conversations/${conversation.id}/turns/${input.clientMessageId}`, cookie))).turn;
    };
    const normal = await run({ clientMessageId: "smoke-normal-operation", content: "初次问题" }, 1);
    const retry = await run({ clientMessageId: "smoke-retry-operation", content: "", retryAssistantMessageId: normal.assistantMessage.id }, 2);
    const edited = await run({ clientMessageId: "smoke-edit-operation", content: "修改问题", editUserMessageId: retry.userMessage.id }, 3);
    const continued = await run({ clientMessageId: "smoke-continue-operation", content: "", continueAssistantMessageId: edited.assistantMessage.id }, 4);
    assert.equal(continued.assistantMessage.content, "fixture-answer-3fixture-answer-4");
    assert.equal(calls().some(call => call.blocked), false);
    console.log("PASS: HTTP normal/retry/edit/continue operation replay during active SSE and after completion, concurrency saturation, single upstream call and single quota reservation");
    const removed = await fetch(base + "/api/channels/fixture", { method: "DELETE", headers: { Origin: base, Cookie: adminCookie } });
    assert.equal(removed.status, 204);
    const replayAfterRemoval = await post(messagePath, { clientMessageId: "smoke-continue-operation", content: "", attachments: [], continueAssistantMessageId: edited.assistantMessage.id }, cookie);
    assert.equal(replayAfterRemoval.status, 200, "accepted replay remains readable after its model channel is removed");
    assert((await replayAfterRemoval.text()).includes("event: done"));
    assert.equal(calls().length, 4);
    assert.equal(await usage(), 4);
    console.log("PASS: terminal replay survives removal of the original model channel without another provider call or quota reservation");
} finally {
    child.kill();
    await child.exited;
    db.close();
    const target = resolve(dataDir);
    if (target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1)?.startsWith("canvas-chat-smoke-")) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) {
            if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        }
    }
}

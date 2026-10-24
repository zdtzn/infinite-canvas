import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openAppDatabase } from "../server/db/database";
import { hashAccessCode } from "../server/lib/auth";
import { encryptSecret } from "../server/lib/crypto-store";
import { createEmailRegistration } from "../server/lib/email-registration";
import { createCultivationService } from "../server/modules/cultivation/service";

// Temporary accounts and database; the child intercepts every outbound fetch.
const dataDir = mkdtempSync(join(tmpdir(), "canvas-image-wallet-smoke-"));
const db = openAppDatabase({ dataDir });
const state = db.loadState();
const password = "SmokePassword8391!";
state.auth.accessCodeHash = await hashAccessCode("SmokeAccess8391!");
state.auth.adminUserId = "admin";
for (const id of ["admin", "member", "emperor"]) state.users[id] = { userId: id, displayName: `Smoke-${id}`, createdAt: 1, admin: id === "admin", loginHash: await hashAccessCode(password) };
state.channels["admin:fixture"] = {
    id: "fixture", userId: "admin", name: "Isolated fixture", baseUrl: "https://8.8.8.8", apiFormat: "openai", apiKey: encryptSecret("fixture-key", state.auth.sessionSecret), updatedAt: 1,
    models: [{ name: "gpt-image-1", capability: "image" }, { name: "text-model", capability: "text" }, { name: "video-model", capability: "video" }, { name: "audio-model", capability: "audio" }],
};
db.saveState(state);
const cultivation = createCultivationService(db.raw!);
cultivation.ensureUser("admin", true);
cultivation.ensureUser("member", false);
cultivation.ensureUser("emperor", false);
const realms = cultivation.getConfiguration().realms;
const topStage = realms.at(-1)!.stages[0].id;
cultivation.updateUser("admin", "member", { stageId: realms.at(-2)!.stages[0].id, dailyLimitOverride: 500, unlimited: true }, "斗帝以下旧普通账号额度夹具");
cultivation.updateUser("admin", "emperor", { stageId: topStage, dailyLimitOverride: 0, unlimited: false }, "斗帝零灵卷与旧覆盖夹具");
const codes: Record<string, string> = {};
const registration = createEmailRegistration(db.raw!, state.auth.sessionSecret, async (email, code) => { codes[email] = code; });
for (const email of ["trial@example.test", "rollback@example.test"]) await registration.request(email, "fixture-ip");
const callsPath = join(dataDir, "upstream-calls.jsonl");
await Bun.write(callsPath, "");
const entryPath = join(dataDir, "fixture-server.ts");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=";
await Bun.write(entryPath, `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "8.8.8.8") throw new Error("Unexpected outbound request blocked by smoke fixture");
    appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ path: url.pathname }) + "\\n");
    if (url.pathname.endsWith("/images/generations")) {
        const body = JSON.parse(String(init.body));
        const count = body.prompt === "use-six-trials" ? body.n : 1;
        return Response.json({ data: Array.from({ length: count }, () => ({ b64_json: ${JSON.stringify(png)} })) });
    }
    if (url.pathname.endsWith("/audio/speech")) return new Response("fixture-audio", { headers: { "content-type": "audio/mpeg" } });
    if (url.pathname.endsWith("/videos")) return Response.json({ id: "fixture-video", status: "queued" });
    return Response.json({ output_text: "fixture-text" });
};
await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dir, "../server/index.ts")).href)});
`);
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);
const base = `http://127.0.0.1:${port}`;
const spawn = () => Bun.spawn([process.execPath, "run", entryPath], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: resolve(import.meta.dir, "../web/dist"), PUBLIC_BASE_URL: base, FORCE_SECURE_COOKIES: "0", APP_ENCRYPTION_KEY: "", ALLOW_NEW_USERS: "1", SMTP_HOST: "127.0.0.1", SMTP_USER: "fixture", SMTP_PASSWORD: "fixture", SMTP_FROM: "fixture@example.test", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0" },
    stdout: "ignore", stderr: "pipe",
});
let child = spawn();
const calls = () => readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map(value => JSON.parse(value));
const get = (path: string, cookie = "") => fetch(base + path, { headers: { Cookie: cookie } });
const post = (path: string, body: unknown, cookie = "", key = "fixture-request") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie, "Idempotency-Key": key }, body: JSON.stringify(body) });
const profile = async (cookie: string) => (await (await get("/api/cultivation/me", cookie)).json()).profile;
const ready = async () => {
    for (let i = 0; i < 80; i++) {
        try { if ((await get("/health")).ok) return; } catch {}
        await Bun.sleep(100);
    }
    throw new Error("Isolated server did not become ready");
};
const waitJob = async (id: string, cookie: string) => {
    for (let i = 0; i < 80; i++) {
        const result = await (await get(`/api/jobs/${id}`, cookie)).json();
        if (["succeeded", "failed", "canceled"].includes(result.job.status)) return result.job;
        await Bun.sleep(50);
    }
    throw new Error("Fixture image job did not finish");
};
try {
    await ready();
    const login = async (id: string) => {
        const response = await post("/api/auth/login", { displayName: `Smoke-${id}`, personalCode: password });
        assert.equal(response.status, 200, await response.clone().text());
        return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    };
    const adminCookie = await login("admin");
    const memberCookie = await login("member");
    const initial = await profile(memberCookie);
    assert.deepEqual([initial.dailyLimit, initial.remainingToday, initial.unlimited, initial.dailyLimitOverride], [0, 0, false, null]);
    assert.equal(initial.proxyQuota.unlimited, true);
    assert.equal((await profile(adminCookie)).unlimited, true);
    const imageInput = { channelId: "fixture", model: "gpt-image-1", prompt: "fixture", count: 2, kind: "proxy", unlimited: true, allowPaidImages: false };
    const denied = await post("/api/jobs/images", imageInput, memberCookie, "unfunded-image");
    assert.equal(denied.status, 402, await denied.clone().text());
    assert.equal((await denied.json()).error.code, "WALLET_INSUFFICIENT");
    assert.equal(calls().length, 0, "insufficient-wallet image never reaches upstream despite client kind");
    assert.equal((await post("/api/ai/fixture/openai/images/generations", imageInput, memberCookie, "forbidden-proxy")).status, 403);
    assert.equal(calls().length, 0, "proxy cannot submit image generation directly");
    const grant = await post("/api/admin/wallet/grants", { userId: "member", packageId: "qiling", reason: "隔离生图计费测试" }, adminCookie, "grant-wallet-smoke");
    assert.equal(grant.status, 200, await grant.clone().text());
    const created = await post("/api/jobs/images", imageInput, memberCookie, "funded-image");
    assert.equal(created.status, 202, await created.clone().text());
    const jobId = (await created.json()).job.id;
    const finished = await waitJob(jobId, memberCookie);
    assert.equal(finished.status, "succeeded", JSON.stringify(finished));
    assert.equal(finished.result.successCount, 1);
    const settled = await profile(memberCookie);
    assert.deepEqual([settled.paidImages, settled.todaySuccessfulImages, settled.usedToday], [39, 1, 0]);
    assert.equal((await post("/api/jobs/images", imageInput, memberCookie, "funded-image")).status, 200);
    assert.equal((await profile(memberCookie)).paidImages, 39, "image creation retry is idempotent");
    const adjusted = await fetch(base + "/api/admin/cultivation/users/member", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: base, Cookie: adminCookie }, body: JSON.stringify({ dailyLimitOverride: 3, unlimited: false, reason: "其他服务预算" }) });
    assert.equal(adjusted.status, 200);
    for (const [path, model] of [["chat/completions", "text-model"], ["audio/speech", "audio-model"], ["videos", "video-model"]]) {
        const response = await post(`/api/ai/fixture/openai/${path}`, { model, input: "fixture", messages: [{ role: "user", content: "fixture" }] }, memberCookie, `proxy-${model}`);
        assert.equal(response.status, 200, await response.clone().text());
    }
    const afterProxy = await profile(memberCookie);
    assert.deepEqual([afterProxy.paidImages, afterProxy.todaySuccessfulImages, afterProxy.proxyQuota.usedToday, afterProxy.proxyQuota.remainingToday], [39, 1, 3, 0]);
    const countBeforeDenial = calls().length;
    assert.equal((await post("/api/ai/fixture/openai/chat/completions", { model: "text-model" }, memberCookie, "proxy-exhausted")).status, 429);
    assert.equal(calls().length, countBeforeDenial, "exhausted proxies never charge wallet or call upstream");
    const retried = await post(`/api/jobs/${jobId}/retry`, { kind: "proxy" }, memberCookie, "retry-image");
    assert.equal(retried.status, 202, await retried.clone().text());
    assert.equal((await waitJob((await retried.json()).job.id, memberCookie)).status, "succeeded");
    assert.equal((await profile(memberCookie)).paidImages, 38, "image retry still bills images with an exhausted proxy quota");
    const emperorCookie = await login("emperor");
    const emperorProfile = await profile(emperorCookie);
    assert.deepEqual([emperorProfile.dailyLimit, emperorProfile.remainingToday, emperorProfile.unlimited, emperorProfile.paidImages, emperorProfile.proxyQuota.dailyLimit], [null, null, true, 0, 0]);
    const freeCreated = await post("/api/jobs/images", imageInput, emperorCookie, "emperor-free-image");
    assert.equal(freeCreated.status, 202, await freeCreated.clone().text());
    assert.equal((await waitJob((await freeCreated.json()).job.id, emperorCookie)).status, "succeeded");
    assert.equal((await profile(emperorCookie)).paidImages, 0, "Dou Emperor generates with no wallet balance despite a zero override");
    const promoted = await fetch(base + "/api/admin/cultivation/users/member", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: base, Cookie: adminCookie }, body: JSON.stringify({ stageId: topStage, dailyLimitOverride: 0, unlimited: false, reason: "突破斗帝" }) });
    assert.equal(promoted.status, 200);
    const afterPromotion = await post("/api/jobs/images", imageInput, memberCookie, "promoted-free-image");
    assert.equal(afterPromotion.status, 202, await afterPromotion.clone().text());
    assert.equal((await waitJob((await afterPromotion.json()).job.id, memberCookie)).status, "succeeded");
    assert.equal((await profile(memberCookie)).paidImages, 38, "new jobs become free immediately after reaching Dou Emperor");
    assert.equal(db.raw!.query("SELECT 1 FROM wallet_ledger WHERE kind = 'registration_grant'").get(), null, "existing accounts receive no registration backfill");
    const rollbackInput = { email: "rollback@example.test", code: codes["rollback@example.test"], displayName: "RollbackUser", personalCode: password };
    db.raw!.exec(`CREATE TRIGGER reject_registration_grant BEFORE INSERT ON wallet_ledger
      WHEN NEW.kind = 'registration_grant' AND EXISTS (SELECT 1 FROM users WHERE user_id = NEW.user_id AND display_name = 'RollbackUser')
      BEGIN SELECT RAISE(ABORT, 'fixture registration failure'); END;`);
    assert.equal((await post("/api/auth/register", rollbackInput)).status, 500);
    assert.equal(db.raw!.query("SELECT 1 FROM users WHERE display_name = 'RollbackUser'").get(), null, "grant failure rolls back account creation");
    assert.equal(db.raw!.query("SELECT 1 FROM user_emails WHERE email = 'rollback@example.test'").get(), null, "grant failure rolls back email binding");
    assert.equal(db.raw!.query("SELECT 1 FROM wallet_ledger WHERE kind = 'registration_grant'").get(), null, "grant failure rolls back balance and ledger");
    db.raw!.exec("DROP TRIGGER reject_registration_grant");
    const recoveredRegistration = await post("/api/auth/register", rollbackInput);
    assert.equal(recoveredRegistration.status, 200, await recoveredRegistration.clone().text());
    const recoveredCookie = recoveredRegistration.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.equal((await profile(recoveredCookie)).paidImages, 6, "registration can retry once after full rollback");
    const trialInput = { email: "trial@example.test", code: codes["trial@example.test"], displayName: "TrialUser", personalCode: password };
    assert.equal((await post("/api/auth/register", { ...trialInput, code: "000000" })).status, 400);
    const registered = await post("/api/auth/register", trialInput);
    assert.equal(registered.status, 200, await registered.clone().text());
    const trialCookie = registered.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const trialUserId = (await registered.json()).user.userId;
    assert.equal((await profile(trialCookie)).paidImages, 6);
    const trialWallet = await (await get("/api/wallet", trialCookie)).json();
    assert.equal(trialWallet.items.length, 1);
    assert.deepEqual([trialWallet.items[0].kind, trialWallet.items[0].delta], ["registration_grant", 6]);
    assert.equal((await post("/api/auth/register", trialInput)).status, 400, "registration retry cannot award another six");
    const sixImages = await post("/api/jobs/images", { ...imageInput, count: 6, prompt: "use-six-trials" }, trialCookie, "use-registration-six");
    assert.equal(sixImages.status, 202, await sixImages.clone().text());
    assert.equal((await waitJob((await sixImages.json()).job.id, trialCookie)).result.successCount, 6);
    assert.equal((await profile(trialCookie)).paidImages, 0);
    const callCountAfterSix = calls().length;
    assert.equal((await post("/api/jobs/images", { ...imageInput, count: 1 }, trialCookie, "trial-exhausted")).status, 402);
    assert.equal(calls().length, callCountAfterSix, "a seventh image requires wallet funds before upstream");
    assert.equal((await post("/api/auth/login", { displayName: "TrialUser", personalCode: password })).status, 200);
    assert.equal((await profile(trialCookie)).paidImages, 0, "login and profile reads never replenish the registration gift");
    child.kill();
    await child.exited;
    child = spawn();
    await ready();
    const restored = await profile(memberCookie);
    assert.deepEqual([restored.dailyLimit, restored.remainingToday, restored.unlimited, restored.paidImages, restored.todaySuccessfulImages, restored.proxyQuota.usedToday], [null, null, true, 38, 3, 4]);
    assert.equal((await profile(emperorCookie)).unlimited, true);
    assert.equal((await profile(trialCookie)).paidImages, 0, "restart never replenishes the registration gift");
    assert.equal((await profile(recoveredCookie)).paidImages, 6);
    assert.deepEqual(db.raw!.query("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id = ? AND kind = 'registration_grant'").get(trialUserId), { count: 1 });
    console.log("PASS: one-time six-image registration gift, atomic registration rollback/retry, no login/profile/restart replenishment or old-user backfill, below-emperor wallet billing, Dou Emperor unlimited images, proxy isolation and image billing/refunds");
} finally {
    child.kill();
    await child.exited;
    db.close();
    const target = resolve(dataDir);
    if (target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1)?.startsWith("canvas-image-wallet-smoke-")) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) {
            if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        }
    }
}

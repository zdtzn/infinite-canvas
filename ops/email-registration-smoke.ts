import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { openAppDatabase } from "../server/db/database";
import { createEmailRegistration } from "../server/lib/email-registration";
import { hashAccessCode } from "../server/lib/auth";

// Isolated database and fake mail transport; never sends real mail or uses user data.
const dataDir = mkdtempSync(join(tmpdir(), "canvas-register-smoke-"));
const db = openAppDatabase({ dataDir });
const state = db.loadState();
state.auth.accessCodeHash = await hashAccessCode("SmokeAccess8391!");
state.auth.adminUserId = "admin";
state.users.admin = { userId: "admin", displayName: "SmokeAdmin", createdAt: Date.now(), admin: true, loginHash: await hashAccessCode("SmokePassword8391!") };
db.saveState(state);
let code = "";
const registration = createEmailRegistration(db.raw!, state.auth.sessionSecret, async (_, value) => { code = value; });
await registration.request("smoke@example.com", "test-ip");
const port = Number(process.env.SMOKE_PORT || 18239);
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, "run", resolve(import.meta.dir, "../server/index.ts")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: resolve(import.meta.dir, "../web/dist"), PUBLIC_BASE_URL: base, ALLOW_NEW_USERS: "1", SMTP_HOST: "127.0.0.1", SMTP_USER: "test", SMTP_PASSWORD: "test", SMTP_FROM: "test@example.com", BACKUP_ENABLED: "0" },
    stdout: "ignore", stderr: "ignore",
});
const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + "/health")).ok) { ready = true; break; } } catch {}
        await Bun.sleep(100);
    }
    assert(ready, "server ready");
    assert.equal((await (await fetch(base + "/api/auth/status")).json()).emailRegistrationEnabled, true);
    assert.equal((await post("/api/auth/login", { displayName: "BypassUser", personalCode: "SmokePassword8391!", accessCode: "SmokeAccess8391!" })).status, 401);
    assert.equal((await post("/api/auth/register", { email: "smoke@example.com", code: "000000", displayName: "NewUser", personalCode: "SmokePassword8391!" })).status, 400);
    const response = await post("/api/auth/register", { email: "smoke@example.com", code, displayName: "NewUser", personalCode: "SmokePassword8391!", admin: true });
    assert.equal(response.status, 200, await response.clone().text());
    const created = await response.json();
    assert.equal(created.user.admin, false);
    assert(response.headers.get("set-cookie")?.includes("canvas_session="));
    assert.equal((await post("/api/auth/register", { email: "smoke@example.com", code, displayName: "OtherUser", personalCode: "SmokePassword8391!" })).status, 400);
    const login = await post("/api/auth/login", { displayName: "NewUser", personalCode: "SmokePassword8391!" });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.userId, created.user.userId);
    const admin = await post("/api/auth/login", { displayName: "SmokeAdmin", personalCode: "SmokePassword8391!" });
    assert.equal(admin.status, 200);
    assert.equal((await admin.json()).user.admin, true);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.equal((await fetch(base + "/api/admin/users", { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await post("/api/auth/login", { displayName: "NewUser", personalCode: "WrongPassword83!" })).status, 401);
    console.log("PASS: registration, verification, one-time code, normal role, session cookie, password login, legacy admin, admin isolation, bypass rejection");
} finally {
    server.kill();
    await server.exited;
    db.close();
}

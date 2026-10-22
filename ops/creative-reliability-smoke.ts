import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openAppDatabase } from "../server/db/database";
import { hashAccessCode } from "../server/lib/auth";
import { assetStorageFilename } from "../server/lib/storage-path";
import { createEmailRegistration } from "../server/lib/email-registration";
import { createPasswordReset } from "../server/lib/password-reset";

// Only generated fixtures in a fresh temporary directory. No real mail, AI calls, or user files.
const dataDir = mkdtempSync(join(tmpdir(), "canvas-reliability-smoke-"));
const db = openAppDatabase({ dataDir });
const state = db.loadState();
const password = "SmokePassword8391!";
state.auth.accessCodeHash = await hashAccessCode("SmokeAccess8391!");
state.auth.adminUserId = "admin";
for (const id of ["admin", "other"]) state.users[id] = { userId: id, displayName: `Smoke-${id}`, createdAt: Date.now(), admin: id === "admin", loginHash: await hashAccessCode(password) };
state.channels["admin:shared"] = {
    id: "shared", userId: "admin", name: "Fixture shared", baseUrl: "https://fixture.example", apiFormat: "openai", apiKey: { iv: "fixture", tag: "fixture", data: "fixture" }, updatedAt: 1,
    models: [{ name: "image-a", capability: "image" }, { name: "image-b", capability: "image" }, { name: "image-c", capability: "image" }, { name: "text-a", capability: "text" }],
};
state.channels["other:private"] = { ...state.channels["admin:shared"], id: "private", userId: "other" };
state.projects.admin = { poster: { project: { id: "poster", title: "测试海报", nodes: [{ metadata: { storageKey: "image:kept" } }] }, updatedAt: Date.now(), revision: 1 } };
for (const [key, userId, recent] of [["image:kept", "admin", false], ["image:unused", "admin", false], ["image:recent", "admin", true], ["image:foreign", "other", false]] as const) {
    const asset = { key, userId, mimeType: "image/png", bytes: 8, createdAt: recent ? Date.now() : Date.now() - 48 * 3_600_000 };
    state.assets[`${userId}:${key}`] = asset;
    mkdirSync(join(dataDir, "assets", userId), { recursive: true });
    await Bun.write(join(dataDir, "assets", userId, assetStorageFilename(key)), "fixture!");
}
db.saveState(state);
const registration = createEmailRegistration(db.raw!, state.auth.sessionSecret, async () => undefined);
registration.bind("admin", "smoke-reset@example.com");
let resetCode = "";
const reset = createPasswordReset(db.raw!, state.auth.sessionSecret, {
    getUser: userId => state.users[userId], commitPassword: () => { throw new Error("Only the HTTP server may reset the fixture"); },
    send: async (_, code) => { resetCode = code; },
});
await reset.request("smoke-reset@example.com", "seed-ip");
await Bun.sleep(0);
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);
const base = `http://127.0.0.1:${port}`;
const child = Bun.spawn([process.execPath, "run", resolve(import.meta.dir, "../server/index.ts")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: resolve(import.meta.dir, "../web/dist"), PUBLIC_BASE_URL: base, ALLOW_NEW_USERS: "0", SMTP_HOST: "127.0.0.1", SMTP_USER: "test", SMTP_PASSWORD: "test", SMTP_FROM: "test@example.com", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0", ASSET_GC_GRACE_MS: String(24 * 3_600_000) },
    stdout: "ignore", stderr: "ignore",
});
const post = (path: string, body: unknown, cookie = "", origin = base) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = "") => fetch(base + path, { headers: { Cookie: cookie } });
const put = (path: string, body: unknown, cookie = "", origin = base) => fetch(base + path, { method: "PUT", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { if ((await get("/health")).ok) { ready = true; break; } } catch {}
        await Bun.sleep(100);
    }
    assert(ready, "isolated server ready");
    const auth = await (await get("/api/auth/status")).json();
    assert.equal(auth.emailRegistrationEnabled, false);
    assert.equal(auth.passwordResetEnabled, true, "recovery remains available when registration is closed");
    assert.equal((await get("/api/storage")).status, 401);
    const login = await post("/api/auth/login", { displayName: "Smoke-admin", personalCode: password });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.equal((await get("/api/model-defaults")).status, 401);
    const memberLogin = await post("/api/auth/login", { displayName: "Smoke-other", personalCode: password });
    assert.equal(memberLogin.status, 200);
    const memberCookie = memberLogin.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const defaultPath = "/api/admin/model-defaults/image";
    const firstTarget = { channelId: "shared", model: "image-a" };
    const secondTarget = { channelId: "shared", model: "image-b" };
    assert.deepEqual(await (await get("/api/model-defaults", memberCookie)).json(), { image: null });
    assert.equal((await put(defaultPath, firstTarget, memberCookie)).status, 403);
    assert.equal((await put(defaultPath, firstTarget, cookie, "https://untrusted.example")).status, 403);
    for (const input of [null, [], { ...firstTarget, model: 12 }, { ...firstTarget, channelId: {} }, { ...firstTarget, model: "x".repeat(201) }, { ...firstTarget, channelId: "__proto__" }]) assert.equal((await put(defaultPath, input, cookie)).status, 400);
    for (const input of [{ ...firstTarget, channelId: "missing" }, { ...firstTarget, channelId: "private" }, { ...firstTarget, model: "text-a" }]) assert.equal((await put(defaultPath, input, cookie)).status, 403);
    const selected = await put(defaultPath, firstTarget, cookie);
    assert.equal(selected.status, 200, await selected.clone().text());
    assert.deepEqual(await selected.json(), { image: { ...firstTarget, revision: 1 } });
    assert.deepEqual(await (await get("/api/model-defaults", memberCookie)).json(), { image: { ...firstTarget, revision: 1 } });
    assert.equal((await get("/api/model-defaults", memberCookie)).headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await (await put(defaultPath, firstTarget, cookie)).json(), { image: { ...firstTarget, revision: 1 } });
    const parallel = await Promise.all([put(defaultPath, secondTarget, cookie), put(defaultPath, { ...secondTarget, model: "image-c" }, cookie)]);
    const changed = await Promise.all(parallel.map(response => response.json()));
    assert.deepEqual(changed.map(value => value.image.revision).sort(), [2, 3]);
    assert.equal((await (await get("/api/model-defaults", memberCookie)).json()).image.revision, 3);
    const removed = await fetch(base + "/api/channels/shared", { method: "DELETE", headers: { Origin: base, Cookie: cookie } });
    assert.equal(removed.status, 204);
    assert.deepEqual(await (await get("/api/model-defaults", memberCookie)).json(), { image: null });
    assert.equal((db.loadSetting("app.default-image-model") as { revision: number }).revision, 3);
    console.log("PASS: shared image default authentication, administrator-only writes, CSRF, validation, capability/channel isolation, cross-user visibility, monotonic revisions and deleted-channel invalidation");
    const overview = await (await get("/api/storage", cookie)).json();
    assert.equal(overview.usedBytes, 24);
    assert.equal(overview.reclaimableBytes, 8);
    assert.equal(overview.items.length, 3);
    assert.deepEqual(overview.items.find((item: { key: string }) => item.key === "image:kept").references, ["画布：测试海报"]);
    assert.equal((await post("/api/storage/cleanup", { keys: ["image:unused"] }, cookie)).status, 400);
    assert.equal((await post("/api/storage/cleanup", null, cookie)).status, 400);
    assert.equal((await post("/api/storage/cleanup", { keys: ["image:unused"], confirmed: true }, cookie, "https://untrusted.example")).status, 403);
    const cleanup = await post("/api/storage/cleanup", { keys: ["image:unused", "image:kept", "image:recent", "image:foreign"], confirmed: true }, cookie);
    assert.equal(cleanup.status, 200, await cleanup.clone().text());
    assert.deepEqual(await cleanup.json(), { deletedCount: 1, freedBytes: 8, skippedCount: 3 });
    assert.equal(existsSync(join(dataDir, "assets", "admin", assetStorageFilename("image:unused"))), false);
    for (const key of ["image:kept", "image:recent"]) assert(existsSync(join(dataDir, "assets", "admin", assetStorageFilename(key))));
    assert(existsSync(join(dataDir, "assets", "other", assetStorageFilename("image:foreign"))));
    assert.equal((await (await get("/api/storage", cookie)).json()).usedBytes, 16);
    const repeated = await post("/api/storage/cleanup", { keys: ["image:unused"], confirmed: true }, cookie);
    assert.equal((await repeated.json()).deletedCount, 0);
    console.log("PASS: storage authentication, account isolation, reference protection, upload grace, explicit confirmation, CSRF, physical cleanup and idempotent repeat");
    const newPassword = "NewSmokePassword9275!";
    const resetInput = { email: "smoke-reset@example.com", code: resetCode, newPassword };
    assert.equal((await post("/api/auth/password-reset-code", null)).status, 400);
    assert.equal((await post("/api/auth/password-reset", null)).status, 400);
    assert.equal((await post("/api/auth/password-reset", resetInput, "", "https://untrusted.example")).status, 403);
    assert.equal((await post("/api/auth/password-reset", { ...resetInput, code: "000000" })).status, 400);
    assert.equal((await post("/api/auth/password-reset", { ...resetInput, newPassword: "12345678" })).status, 400);
    const recovered = await post("/api/auth/password-reset", resetInput);
    assert.equal(recovered.status, 200, await recovered.clone().text());
    assert.equal((await post("/api/auth/password-reset", resetInput)).status, 400, "code is one-use");
    assert.equal((await get("/api/storage", cookie)).status, 401, "old sessions revoked");
    assert.equal((await post("/api/auth/login", { displayName: "Smoke-admin", personalCode: password })).status, 401);
    const relogin = await post("/api/auth/login", { displayName: "Smoke-admin", personalCode: newPassword });
    assert.equal(relogin.status, 200);
    assert.equal((await relogin.json()).user.admin, true, "reset does not change role");
    const unknown = await post("/api/auth/password-reset-code", { email: "unknown@example.com" });
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).ok, true, "non-enumerating unknown-address response");
    assert.equal((await post("/api/auth/password-reset-code", { email: "unknown@example.com" })).status, 429);
    console.log("PASS: password reset with registration closed, CSRF, invalid/weak rejection, one-use code, old session revocation, new login and resend rate limit");
} finally {
    child.kill();
    await child.exited;
    db.close();
    const target = resolve(dataDir);
    if (target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1)?.startsWith("canvas-reliability-smoke-")) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) {
            // Bun on Windows may briefly retain a closed SQLite file handle.
            if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
            console.warn("Temporary smoke fixtures are still locked by the runtime; retained in the system temp directory.");
        }
    }
}

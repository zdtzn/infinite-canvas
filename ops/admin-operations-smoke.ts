import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { openAppDatabase } from "../server/db/database";
import { hashAccessCode } from "../server/lib/auth";

// Real HTTP against a fresh fixture database; no model channels, mail or external requests.
const fixturePrefix = "canvas-admin-operations-smoke-";
const dataDir = mkdtempSync(join(tmpdir(), fixturePrefix));
const db = openAppDatabase({ dataDir });
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
    const state = db.loadState();
    const password = "SmokeAdminPassword8391!";
    const loginHash = await hashAccessCode(password);
    state.auth.accessCodeHash = await hashAccessCode("SmokeAccess8391!");
    state.auth.adminUserId = "admin";
    const memberId = "smoke-member-uid";
    const otherId = "smoke-other-uid";
    const literalId = "uid_%\\literal";
    for (const [userId, displayName, createdAt] of [["admin", "Smoke-Admin", 1], [memberId, "Smoke-Member", 2], [otherId, "Smoke-Other", 3], [literalId, "昵称_%\\匹配", 4]] as const)
        state.users[userId] = { userId, displayName, createdAt, admin: userId === "admin", loginHash, sessionVersion: 1 };
    db.saveState(state);
    db.saveSetting("app.prompt-sources", []);
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    const base = `http://127.0.0.1:${port}`;
    child = Bun.spawn([process.execPath, "run", resolve(import.meta.dir, "../server/index.ts")], {
        env: {
            ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: join(dataDir, "web"), PUBLIC_BASE_URL: base,
            ALLOW_NEW_USERS: "0", FORCE_SECURE_COOKIES: "0", TRUST_PROXY: "0", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0",
            SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "", APP_ENCRYPTION_KEY: "", APP_ENCRYPTION_KEY_PREVIOUS: "",
        },
        stdout: "ignore", stderr: "ignore",
    });
    const request = (method: string, path: string, body?: unknown, cookie = "", origin = base) => fetch(base + path, {
        method, headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    const get = (path: string, cookie = "") => request("GET", path, undefined, cookie);
    const put = (path: string, body: unknown, cookie = "", origin = base) => request("PUT", path, body, cookie, origin);
    const read = async (response: Response, status = 200) => {
        const text = await response.text();
        assert.equal(response.status, status, text);
        return text ? JSON.parse(text) : undefined;
    };
    let ready = false;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        try { if ((await get("/health")).ok) { ready = true; break; } } catch {}
        if (child.exitCode !== null) break;
        await Bun.sleep(100);
    }
    assert(ready, "isolated fixture HTTP server must start");
    const login = async (displayName: string) => {
        const response = await request("POST", "/api/auth/login", { displayName, personalCode: password });
        await read(response);
        return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    };
    const adminCookie = await login("Smoke-Admin");
    const memberCookie = await login("Smoke-Member");
    await login("Smoke-Member");
    await read(await request("POST", "/api/auth/login", { displayName: "Smoke-Other", personalCode: "WrongPassword8391!" }), 401);
    const balancePath = (userId: string) => `/api/admin/cultivation/users/${encodeURIComponent(userId)}/image-balance`;
    const path = balancePath(memberId);
    const valid = { imageBalance: 12, expectedImageBalance: 0, adjustmentId: randomUUID(), reason: "HTTP首次数" };
    await read(await put(path, valid), 401);
    await read(await put(path, valid, memberCookie), 403);
    await read(await put(path, valid, adminCookie, "https://untrusted.example"), 403);
    const invalid = [
        null, [], {}, { ...valid, imageBalance: "12" }, { ...valid, imageBalance: 1.5 }, { ...valid, imageBalance: -1 },
        { ...valid, imageBalance: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, expectedImageBalance: "0" },
        { ...valid, expectedImageBalance: -1 }, { ...valid, expectedImageBalance: 0.5 }, { ...valid, expectedImageBalance: Number.MAX_SAFE_INTEGER + 1 },
        { ...valid, expectedImageBalance: undefined }, { ...valid, adjustmentId: "invalid" }, { ...valid, reason: null },
        { ...valid, reason: "x".repeat(301) }, { ...valid, xpDelta: 20 }, { ...valid, stageId: "realm-dou-emperor" },
    ];
    for (const input of invalid) await read(await put(path, input, adminCookie), 400);
    assert.equal((db.raw!.query("SELECT COUNT(*) AS count FROM wallet_ledger").get() as { count: number }).count, 0);
    assert.equal((db.raw!.query("SELECT COUNT(*) AS count FROM admin_audit_logs").get() as { count: number }).count, 0);
    console.log("PASS: real HTTP authentication, administrator authorization, CSRF and strict adjustment validation");

    const first = await put(path, valid, adminCookie);
    assert.equal(first.headers.get("Cache-Control"), "no-store");
    assert.equal((await read(first)).profile.paidImages, 12);
    assert.equal((await read(await put(path, { imageBalance: 4, expectedImageBalance: 12, adjustmentId: randomUUID() }, adminCookie))).profile.paidImages, 4);
    assert.equal((await read(await put(path, valid, adminCookie))).profile.paidImages, 4, "replay must not undo a later adjustment");
    assert.equal((db.raw!.query("SELECT COUNT(*) AS count FROM wallet_ledger WHERE source_id = ?").get(valid.adjustmentId) as { count: number }).count, 1);
    assert.equal((db.raw!.query("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action = 'cultivation.user.image_balance' AND reason = ?").get(valid.reason) as { count: number }).count, 1);
    assert.equal((await read(await put(path, { imageBalance: 0, expectedImageBalance: 4, adjustmentId: randomUUID() }, adminCookie))).profile.paidImages, 0);
    const wallet = await read(await get("/api/wallet", memberCookie));
    assert.equal(wallet.balance, 0);
    assert.deepEqual(wallet.items.map((item: { delta: number }) => item.delta), [-4, -8, 12]);
    const noOp = { imageBalance: 0, expectedImageBalance: 0, adjustmentId: randomUUID() };
    await read(await put(path, noOp, adminCookie));
    await read(await put(path, { imageBalance: 7, expectedImageBalance: 0, adjustmentId: randomUUID() }, adminCookie));
    assert.equal((await read(await put(path, noOp, adminCookie))).profile.paidImages, 7, "no-op replay must preserve later credits");
    await read(await put(path, { imageBalance: 20, expectedImageBalance: 0, adjustmentId: randomUUID() }, adminCookie), 409);
    await read(await put(balancePath(otherId), valid, adminCookie), 409);
    const simultaneous = await Promise.all([8, 9].map((imageBalance) => put(path, { imageBalance, expectedImageBalance: 7, adjustmentId: randomUUID() }, adminCookie)));
    assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 409], "only one concurrent CAS may apply");
    for (const response of simultaneous) await response.text();
    await read(await put(balancePath(otherId), { imageBalance: 2, expectedImageBalance: 0, adjustmentId: randomUUID() }, adminCookie));
    assert.equal((db.raw!.query("SELECT COUNT(*) AS count FROM wallet_ledger").get() as { count: number }).count, 7);
    console.log("PASS: absolute increase/decrease/zero, durable replay and no-op safety, ledger/audit once, cross-user key isolation and concurrent/stale CAS");

    const users = (search: string, page = 1, pageSize = 20) => get(`/api/admin/cultivation/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`, adminCookie);
    for (const search of ["%", "_", "\\", "昵称", "uid_%\\"])
        assert.deepEqual((await read(await users(search))).items.map((user: { userId: string }) => user.userId), [literalId]);
    assert.deepEqual((await read(await users("smoke-member"))).items.map((user: { userId: string }) => user.userId), [memberId]);
    assert.deepEqual((await read(await users("Member"))).items.map((user: { userId: string }) => user.userId), [memberId]);
    const userPage = await read(await users("Smoke", 2, 2));
    assert.equal(userPage.total, 3);
    assert.equal(userPage.items.length, 1);
    const logs = (kind: string, userId = "", page = 1, pageSize = 20) => get(`/api/admin/cultivation/${kind}?userId=${encodeURIComponent(userId)}&page=${page}&pageSize=${pageSize}`, adminCookie);
    const auditPage = await read(await logs("audit-logs", memberId, 1, 2));
    assert.equal(auditPage.total, 6);
    assert.equal(auditPage.items.length, 2);
    assert(auditPage.items.every((row: { target_user_id: string }) => row.target_user_id === memberId));
    assert.equal((await read(await logs("audit-logs", memberId, 4, 2))).items.length, 0);
    assert.equal((await read(await logs("audit-logs", otherId))).total, 1);
    assert.equal((await read(await logs("audit-logs", "admin"))).total, 0, "audit user filter means target, not operator");
    assert.equal((await read(await logs("audit-logs"))).total, 7);
    const loginPage = await read(await logs("login-logs", memberId, 2, 1));
    assert.equal(loginPage.total, 2);
    assert.equal(loginPage.items.length, 1);
    assert.equal(loginPage.items[0].user_id, memberId);
    assert.equal((await read(await logs("login-logs", "admin"))).total, 1);
    assert.equal((await read(await logs("login-logs", otherId))).total, 1);
    assert.equal((await read(await logs("login-logs"))).total, 4);
    console.log("PASS: literal nickname/UID search, user pagination and target-user audit/login filters with correct response totals");
} finally {
    if (child) { child.kill(); await child.exited; }
    db.close();
    const target = resolve(dataDir);
    assert(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith(fixturePrefix), "cleanup must remain inside the generated temporary fixture directory");
    try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) {
        if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        console.warn("Temporary smoke fixtures remain locked by Windows; retained in the system temp directory.");
    }
}

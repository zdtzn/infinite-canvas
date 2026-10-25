import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openAppDatabase } from "../server/db/database";
import { hashAccessCode } from "../server/lib/auth";
import { encryptSecret } from "../server/lib/crypto-store";
import { createCultivationService } from "../server/modules/cultivation/service";
import { DEFAULT_ANNOUNCEMENT_STYLE } from "../shared/announcement-style";

// Fresh temporary SQLite/accounts only. The child blocks every real outbound fetch.
const fixturePrefix = "canvas-job-replay-smoke-";
const dataDir = mkdtempSync(join(tmpdir(), fixturePrefix));
const db = openAppDatabase({ dataDir });
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
    const state = db.loadState();
    const password = "SmokePassword8391!";
    const loginHash = await hashAccessCode(password);
    state.auth.accessCodeHash = await hashAccessCode("SmokeAccess8391!");
    state.auth.adminUserId = "admin";
    for (const userId of ["admin", "member"])
        state.users[userId] = { userId, displayName: `Smoke-${userId}`, createdAt: 1, admin: userId === "admin", loginHash };
    state.channels["admin:fixture"] = {
        id: "fixture", userId: "admin", name: "Isolated fixture", baseUrl: "https://8.8.8.8", apiFormat: "openai",
        apiKey: encryptSecret("fixture-key", state.auth.sessionSecret), updatedAt: 1,
        models: [{ name: "gpt-image-1", capability: "image" }],
    };
    const missingSourceId = "missing-reference-source";
    const missingReferencePath = join("job-references", "member", missingSourceId, "0.bin");
    state.jobs[missingSourceId] = {
        id: missingSourceId, status: "failed", createdAt: Date.now(), finishedAt: Date.now(), error: "Fixture missing reference",
        input: { userId: "member", channelId: "fixture", apiFormat: "openai", model: "gpt-image-1", prompt: "fixture", count: 1,
            references: [{ path: missingReferencePath.replaceAll("\\", "/"), mimeType: "image/png", bytes: 68 }] },
    };
    db.saveState(state);
    db.saveSetting("app.prompt-sources", []);
    const cultivation = createCultivationService(db.raw!);
    cultivation.ensureUser("admin", true);
    cultivation.ensureUser("member", false);
    cultivation.grantWalletPackage("admin", "member", "qiling", "fixture-wallet-grant", "隔离幂等回放测试");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=";
    const callsPath = join(dataDir, "upstream-calls.jsonl");
    await Bun.write(callsPath, "");
    const entryPath = join(dataDir, "fixture-server.ts");
    await Bun.write(entryPath, `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "8.8.8.8") throw new Error("Unexpected outbound request blocked by smoke fixture");
    appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ path: url.pathname }) + "\\n");
    if (!url.pathname.endsWith("/images/generations") && !url.pathname.endsWith("/images/edits")) throw new Error("Unexpected fixture endpoint");
    await Bun.sleep(150);
    return Response.json({ data: [{ b64_json: ${JSON.stringify(png)} }] });
};
await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dir, "../server/index.ts")).href)});
`);
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    const base = `http://127.0.0.1:${port}`;
    const spawn = () => Bun.spawn([process.execPath, "run", entryPath], {
        env: {
            ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: join(dataDir, "web"), PUBLIC_BASE_URL: base,
            ALLOW_NEW_USERS: "0", FORCE_SECURE_COOKIES: "0", TRUST_PROXY: "0", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0",
            SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "", APP_ENCRYPTION_KEY: "", APP_ENCRYPTION_KEY_PREVIOUS: "",
        },
        stdout: "ignore", stderr: "ignore",
    });
    const request = (method: string, path: string, body: unknown, cookie = "", key = "fixture-request", raw = false) => fetch(base + path, {
        method, headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie, "Idempotency-Key": key },
        ...(body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    const read = async (response: Response, status = 200) => {
        const text = await response.text();
        assert.equal(response.status, status, text);
        return text ? JSON.parse(text) : undefined;
    };
    const ready = async () => {
        for (let i = 0; i < 80; i++) {
            try { if ((await request("GET", "/health", undefined)).ok) return; } catch {}
            await Bun.sleep(100);
        }
        throw new Error("Isolated server did not become ready");
    };
    const calls = () => readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).length;
    const accounting = () => ({
        calls: calls(),
        usages: db.raw!.query("SELECT COUNT(*) AS count FROM generation_usage").get(),
        ledger: db.raw!.query("SELECT COUNT(*) AS count FROM wallet_ledger").get(),
        balance: db.raw!.query("SELECT image_balance FROM wallet_balances WHERE user_id = 'member'").get(),
    });
    const waitJob = async (id: string, cookie: string) => {
        for (let i = 0; i < 100; i++) {
            const { job } = await read(await request("GET", `/api/jobs/${id}`, undefined, cookie));
            if (["succeeded", "failed", "canceled"].includes(job.status)) return job;
            await Bun.sleep(30);
        }
        throw new Error("Fixture image job did not finish");
    };
    child = spawn();
    await ready();
    const login = async (userId: string) => {
        const response = await request("POST", "/api/auth/login", { displayName: `Smoke-${userId}`, personalCode: password });
        await read(response, 200);
        return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    };
    const adminCookie = await login("admin");
    const cookie = await login("member");
    const imageInput = { channelId: "fixture", model: "gpt-image-1", prompt: "fixture", count: 1 };
    const create = (key: string, input: unknown = imageInput) => request("POST", "/api/jobs/images", input, cookie, key);
    const retry = (id: string, key: string) => request("POST", `/api/jobs/${id}/retry`, {}, cookie, key);
    const removed = async (id: string) => {
        await read(await request("DELETE", `/api/jobs/${id}?remove=1`, undefined, cookie), 204);
        assert.equal((await request("GET", `/api/jobs/${id}`, undefined, cookie)).status, 404);
    };
    const rejectedWithoutAccounting = async (operation: () => Promise<Response>) => {
        const before = accounting();
        await read(await operation(), 409);
        assert.deepEqual(accounting(), before, "rejected replay makes no upstream call, reservation, refund or wallet entry");
    };
    const duplicate = await Promise.all([create("create-once"), create("create-once"), create("create-once")]);
    assert.deepEqual(duplicate.map(response => response.status).sort(), [200, 200, 202]);
    const originals = await Promise.all(duplicate.map(response => response.json()));
    const originalId = originals[0].job.id;
    assert(originals.every(value => value.job.id === originalId));
    assert.equal((await waitJob(originalId, cookie)).status, "succeeded");
    assert.equal(calls(), 1);
    assert.equal(cultivation.getProfile("member").paidImages, 39);
    const beforeReplay = accounting();
    await read(await create("create-once"), 200);
    assert.deepEqual(accounting(), beforeReplay, "existing task replay does not reserve or submit twice");

    const retryResponses = await Promise.all([retry(originalId, "retry-once"), retry(originalId, "retry-once")]);
    assert.deepEqual(retryResponses.map(response => response.status).sort(), [200, 202]);
    const retryBodies = await Promise.all(retryResponses.map(response => response.json()));
    const retryId = retryBodies[0].job.id;
    assert.equal(retryBodies[1].job.id, retryId);
    assert.equal((await waitJob(retryId, cookie)).status, "succeeded");
    assert.equal(calls(), 2);
    assert.equal(cultivation.getProfile("member").paidImages, 38);
    await removed(retryId);
    await rejectedWithoutAccounting(() => retry(originalId, "retry-once"));
    const newRetryId = (await read(await retry(originalId, "retry-new-key"), 202)).job.id;
    assert.equal(cultivation.getGenerationUsage(newRetryId)?.status, "reserved", "fresh retry key reserves before calling upstream");
    assert.equal((await waitJob(newRetryId, cookie)).status, "succeeded");
    assert.equal(cultivation.getProfile("member").paidImages, 37);
    await removed(originalId);
    await rejectedWithoutAccounting(() => create("create-once"));
    const newOriginalId = (await read(await create("create-new-key"), 202)).job.id;
    assert.equal(cultivation.getGenerationUsage(newOriginalId)?.status, "reserved", "fresh create key reserves before calling upstream");
    assert.equal((await waitJob(newOriginalId, cookie)).status, "succeeded");
    assert.equal(cultivation.getProfile("member").paidImages, 36);
    console.log("PASS: concurrent/existing create and retry replay, terminal deletion rejection with zero upstream/accounting changes, and fresh-key reservations");

    const failedCreateKey = "failed-create-reservation";
    const failedCreateId = createHash("sha256").update(`member:${failedCreateKey}`).digest("hex");
    mkdirSync(join(dataDir, "job-references", "member"), { recursive: true });
    await Bun.write(join(dataDir, "job-references", "member", failedCreateId), "fixture blocks reference directory creation");
    const referencedInput = { ...imageInput, references: [`data:image/png;base64,${png}`] };
    const beforeFailure = accounting();
    await read(await create(failedCreateKey, referencedInput), 500);
    assert.equal(cultivation.getGenerationUsage(failedCreateId)?.status, "refunded");
    assert.equal(calls(), beforeFailure.calls);
    assert.equal(cultivation.getProfile("member").paidImages, 36, "failed reference persistence refunds the reservation");
    await rejectedWithoutAccounting(() => create(failedCreateKey, referencedInput));
    const newReferencedId = (await read(await create("failed-create-fresh-key", referencedInput), 202)).job.id;
    assert.equal((await waitJob(newReferencedId, cookie)).status, "succeeded");

    const failedRetryKey = "failed-retry-reservation";
    const failedRetryId = createHash("sha256").update(`member:retry:${missingSourceId}:${failedRetryKey}`).digest("hex");
    const beforeRetryFailure = accounting();
    await read(await retry(missingSourceId, failedRetryKey), 404);
    assert.equal(cultivation.getGenerationUsage(failedRetryId)?.status, "refunded");
    assert.equal(calls(), beforeRetryFailure.calls);
    assert.deepEqual(accounting().balance, beforeRetryFailure.balance);
    mkdirSync(join(dataDir, "job-references", "member", missingSourceId), { recursive: true });
    await Bun.write(join(dataDir, missingReferencePath), Buffer.from(png, "base64"));
    await rejectedWithoutAccounting(() => retry(missingSourceId, failedRetryKey));
    const newReferenceRetry = (await read(await retry(missingSourceId, "failed-retry-fresh-key"), 202)).job.id;
    assert.equal((await waitJob(newReferenceRetry, cookie)).status, "succeeded");
    console.log("PASS: create/retry failure after reservation refunds once, blocks same-key resubmission, and permits fresh-key generation");

    child.kill();
    await child.exited;
    child = spawn();
    await ready();
    await rejectedWithoutAccounting(() => create("create-once"));
    await rejectedWithoutAccounting(() => create(failedCreateKey, referencedInput));
    await rejectedWithoutAccounting(() => retry(missingSourceId, failedRetryKey));
    // Keep a source task while removing its completed retry, then prove the guard survives restart.
    const restartRetry = (await read(await retry(newOriginalId, "restart-retry-key"), 202)).job.id;
    assert.equal((await waitJob(restartRetry, cookie)).status, "succeeded");
    await removed(restartRetry);
    child.kill();
    await child.exited;
    child = spawn();
    await ready();
    await rejectedWithoutAccounting(() => retry(newOriginalId, "restart-retry-key"));
    const beforeRestartReplay = accounting();
    await read(await create("create-new-key"), 200);
    assert.deepEqual(accounting(), beforeRestartReplay);
    console.log("PASS: persisted settled/refunded usage rejects removed-task keys after restart; existing tasks still replay");

    const announcement = { title: "题".repeat(120), summary: "摘".repeat(240), content: "文".repeat(8_000),
        style: DEFAULT_ANNOUNCEMENT_STYLE, type: "notice", status: "draft", pinned: false };
    assert(Buffer.byteLength(JSON.stringify(announcement)) > 16 * 1024);
    assert.equal((await request("POST", "/api/admin/announcements", announcement, cookie)).status, 403);
    const createdAnnouncement = await read(await request("POST", "/api/admin/announcements", announcement, adminCookie), 201);
    assert.equal(createdAnnouncement.item.content, announcement.content);
    assert.deepEqual(createdAnnouncement.item.style, announcement.style);
    const announcementPath = `/api/admin/announcements/${createdAnnouncement.item.id}`;
    const emojiAnnouncement = { ...announcement, content: "😀".repeat(4_000) };
    assert.equal(emojiAnnouncement.content.length, 8_000, "field limit measures UTF-16 code units");
    assert.equal((await read(await request("POST", "/api/admin/announcements", emojiAnnouncement, adminCookie), 201)).item.content, emojiAnnouncement.content);
    assert.equal((await read(await request("PATCH", announcementPath, emojiAnnouncement, adminCookie))).item.content, emojiAnnouncement.content);
    const escaped = JSON.stringify(announcement).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    assert(Buffer.byteLength(escaped) > 48 * 1024 && Buffer.byteLength(escaped) < 64 * 1024);
    const escapedCreated = await read(await request("POST", "/api/admin/announcements", escaped, adminCookie, "fixture", true), 201);
    assert.equal(escapedCreated.item.content, announcement.content);
    assert.equal((await read(await request("PATCH", announcementPath, escaped, adminCookie, "fixture", true))).item.content, announcement.content);
    for (const method of ["POST", "PATCH"]) {
        const path = method === "POST" ? "/api/admin/announcements" : announcementPath;
        for (const content of ["文".repeat(8_001), "😀".repeat(4_000) + "文"])
            assert.equal((await request(method, path, { ...announcement, content }, adminCookie)).status, 400);
        assert.equal((await request(method, path, { ...announcement, style: { body: { size: 29 } } }, adminCookie)).status, 400);
        assert.equal((await request(method, path, { ...announcement, content: "文".repeat(30_000) }, adminCookie)).status, 413);
    }
    console.log("PASS: announcement POST/PATCH accept 8000-unit Chinese/emoji and escaped JSON plus complete style, enforce field/style limits and retain 64KiB body cap");
} finally {
    child?.kill();
    if (child) await child.exited;
    db.close();
    const target = resolve(dataDir);
    if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith(fixturePrefix)) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) {
            if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        }
    }
}

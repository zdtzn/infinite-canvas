import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openAppDatabase } from "../server/db/database";
import { createSessionToken } from "../server/lib/auth";
import { encryptSecret } from "../server/lib/crypto-store";
import { createCultivationService } from "../server/modules/cultivation/service";

// Temporary accounts/database and a child with all outbound requests intercepted.
const prefix = "canvas-sadai-smoke-";
const dataDir = mkdtempSync(join(tmpdir(), prefix));
const db = openAppDatabase({ dataDir });
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
    const state = db.loadState();
    state.auth.adminUserId = "admin";
    state.users.admin = { userId: "admin", displayName: "Fixture admin", admin: true, createdAt: 1 };
    state.users.member = { userId: "member", displayName: "Fixture member", createdAt: 1 };
    state.channels["admin:sadai"] = { id: "sadai", userId: "admin", name: "Fixture SADAI", baseUrl: "https://api.sadai.top/v1",
        apiFormat: "openai", apiKey: encryptSecret("fixture-key", state.auth.sessionSecret), updatedAt: 1,
        models: [{ name: "gpt-image-2.6-flare", capability: "image" }] };
    db.saveState(state);
    db.saveSetting("app.prompt-sources", []);
    const cultivation = createCultivationService(db.raw!);
    cultivation.ensureUser("member", false);
    cultivation.grantRegistrationImages("member");
    const cookie = `canvas_session=${createSessionToken({ userId: "member", displayName: "Fixture member", sessionVersion: 1 }, state.auth.sessionSecret)}`;
    const callsPath = join(dataDir, "calls.jsonl");
    const modePath = join(dataDir, "mode.txt");
    await Bun.write(callsPath, "");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=";
    const entryPath = join(dataDir, "fixture-server.ts");
    await Bun.write(entryPath, `
import { appendFileSync, readFileSync } from "node:fs";
import { JobQueue } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dir, "../server/lib/job-queue.ts")).href)};
const changed = JobQueue.prototype.changed;
JobQueue.prototype.changed = async function(job) {
    if (job.status === "running" && job.input.prompt === "fixture-storage-failure") throw new Error("Fixture running persistence failure");
    return changed.call(this, job);
};
let transientPolls = 0;
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const mode = readFileSync(${JSON.stringify(modePath)}, "utf8");
    const method = init?.method || "GET";
    if (url.hostname !== "api.sadai.top" && url.hostname !== "images.example.com") throw new Error("Real outbound request blocked by fixture");
    appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ method, path: url.pathname, mode }) + "\\n");
    if (url.hostname === "images.example.com") return new Response(Buffer.from(${JSON.stringify(png)}, "base64"), { headers: { "Content-Type": "image/png" } });
    if (method === "POST" && url.pathname === "/v1/images/tasks") {
        if (mode === "submit404") return new Response("not found", { status: 404 });
        const submits = readFileSync(${JSON.stringify(callsPath)}, "utf8").trim().split("\\n").map(JSON.parse).filter(item => item.method === "POST" && item.path === "/v1/images/tasks").length;
        return Response.json({ id: "fixture-task-" + submits, status: "QUEUED" });
    }
    if (method === "GET" && url.pathname.startsWith("/v1/images/tasks/")) {
        if (mode === "hold") return Response.json({ status: "QUEUED" });
        if (mode === "poll401") return Response.json({ error: { message: "fixture temporary credentials failure" } }, { status: 401 });
        if (mode === "flaky" && transientPolls++ < 2) return Response.json({}, { status: transientPolls === 1 ? 503 : 404 });
        return Response.json({ status: "SUCCESS", response: { data: [{ url: "https://images.example.com/fixture.png" }] } });
    }
    if (method === "POST" && url.pathname === "/v1/images/generations" && mode === "submit404") {
        if (JSON.parse(init.body).response_format !== "url") throw new Error("Async fallback incorrectly disabled URL responses");
        return Response.json({ data: [{ url: "https://images.example.com/fixture.png" }] });
    }
    throw new Error("Unexpected fixture endpoint: " + method + " " + url.pathname);
};
await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dir, "../server/index.ts")).href)});
`);
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    const base = `http://127.0.0.1:${port}`;
    const start = () => Bun.spawn([process.execPath, "run", entryPath], {
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_ROOT: join(dataDir, "web"), PUBLIC_BASE_URL: base,
            FORCE_SECURE_COOKIES: "0", TRUST_PROXY: "0", BACKUP_ENABLED: "0", ASSET_GC_ENABLED: "0", ALLOW_NEW_USERS: "0",
            SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "", APP_ENCRYPTION_KEY: "", APP_ENCRYPTION_KEY_PREVIOUS: "" },
        stdout: "ignore", stderr: Bun.file(join(dataDir, "stderr.log")),
    });
    const request = (method: string, path: string, body?: unknown, key = "fixture") => fetch(base + path, {
        method, headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json", "Idempotency-Key": key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    const json = async (response: Response, status = 200) => {
        const text = await response.text();
        assert.equal(response.status, status, text);
        return JSON.parse(text);
    };
    const until = async (condition: () => Promise<boolean>, timeoutMs = 10_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await condition()) return;
            await Bun.sleep(150);
        }
        throw new Error(`Fixture timed out: ${readFileSync(join(dataDir, "stderr.log"), "utf8").slice(-2_000)}`);
    };
    const ready = () => until(async () => { try { return (await request("GET", "/health")).ok; } catch { return false; } });
    const calls = () => readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const submits = () => calls().filter(item => item.method === "POST" && item.path === "/v1/images/tasks").length;
    const syncs = () => calls().filter(item => item.method === "POST" && item.path === "/v1/images/generations").length;
    const create = async (key: string, prompt = "fixture") => (await json(await request("POST", "/api/jobs/images", {
        channelId: "sadai", model: "gpt-image-2.6-flare", prompt, count: 1,
    }, key), 202)).job;
    const finished = async (id: string) => {
        let job: any;
        await until(async () => {
            job = (await json(await request("GET", `/api/jobs/${id}`))).job;
            return ["succeeded", "failed", "canceled"].includes(job.status);
        });
        return job;
    };
    await Bun.write(modePath, "hold");
    child = start();
    await ready();
    const first = await create("restart-task");
    await until(async () => db.loadState().jobs[first.id]?.input.upstream?.taskId === "fixture-task-1");
    assert.equal(cultivation.getWallet("member").balance, 5);
    child.kill("SIGKILL");
    await child.exited;
    await Bun.write(modePath, "success");
    child = start();
    await ready();
    assert.equal((await finished(first.id)).status, "succeeded");
    assert.equal(submits(), 1);
    assert.equal(cultivation.getWallet("member").balance, 5);
    assert.equal(cultivation.getGenerationUsage(first.id)?.status, "settled");
    console.log("PASS: restart recovers the persisted SADAI task, submits once and charges once");

    await Bun.write(modePath, "flaky");
    const second = await create("flaky-query");
    assert.equal((await finished(second.id)).status, "succeeded");
    assert.equal(submits(), 2);
    assert.equal(syncs(), 0);
    assert.equal(cultivation.getWallet("member").balance, 4);
    console.log("PASS: transient 503 and polling 404 query the same task without sync generation");

    await Bun.write(modePath, "poll401");
    const failed = await create("failed-query");
    assert.equal((await finished(failed.id)).status, "failed");
    assert.equal(cultivation.getWallet("member").balance, 4);
    await Bun.write(modePath, "success");
    const retried = (await json(await request("POST", `/api/jobs/${failed.id}/retry`, {}, "recover-original"), 202)).job;
    assert.equal((await finished(retried.id)).status, "succeeded");
    assert.equal(submits(), 3);
    assert.equal(cultivation.getWallet("member").balance, 3);
    assert.equal(db.loadState().jobs[retried.id].input.upstream?.taskId, "fixture-task-3");
    console.log("PASS: failed-query refund and retry reuse the original provider task with one final charge");

    const storageFailure = await create("storage-failure", "fixture-storage-failure");
    assert.equal((await finished(storageFailure.id)).status, "failed");
    assert.equal(cultivation.getGenerationUsage(storageFailure.id)?.status, "refunded");
    assert.equal(cultivation.getWallet("member").balance, 3);
    assert.equal(submits(), 3);
    console.log("PASS: running-state persistence failure refunds immediately before any provider call");

    await Bun.write(modePath, "submit404");
    assert.equal((await finished((await create("missing-endpoint")).id)).status, "succeeded");
    assert.equal(submits(), 4);
    assert.equal(syncs(), 1);
    assert.equal(cultivation.getWallet("member").balance, 2);
    console.log("PASS: only a submission 404 falls back once and preserves URL results");
} finally {
    child?.kill("SIGKILL");
    if (child) await child.exited;
    db.close();
    const target = resolve(dataDir);
    if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith(prefix)) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) { if (!["EBUSY", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")) throw error; }
    }
}

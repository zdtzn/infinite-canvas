import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { isIP } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

import { createIdentityToken, createSessionToken, expiredIdentityCookie, expiredSessionCookie, hashAccessCode, identityCookie, readCookie, readIdentityToken, readSessionToken, sessionCookie, verifyAccessCode, type SessionPayload } from "./lib/auth";
import { decryptSecret, encryptSecret } from "./lib/crypto-store";
import { decodeImageDataUrl, detectImageMimeFromBytes, isAllowedImageMimeType, resolveImageMimeType } from "./lib/image-mime";
import { buildOpenAiImageRequestOptions, resolveOpenAiImageSize } from "./lib/image-request";
import { JobQueue, type QueueJob } from "./lib/job-queue";
import { buildUuAsyncImageRequest, isUuAsyncGptImage2Channel, isUuImageAsyncChannel, readUuAsyncTask } from "./lib/uu-image-async";
import { assertAllowedUpstreamUrl, assertResolvedPublicUpstreamUrl, buildUpstreamUrl, resolveAllowedRedirect, type ProviderProtocol } from "./lib/url-policy";
import { openAppDatabase, persistReference } from "./db/database";
import { createCultivationService, CultivationError, type CultivationCapabilityUpdate, type CultivationRealmUpdate, type CultivationStageUpdate, type CultivationUserUpdate } from "./modules/cultivation/service";
import type { ChannelRecord, ImageJobImage, ImageJobInput, ImageJobOutput, StoredAsset, StoredImageJob, StoredImageReference, UserRecord } from "./types";

class AsyncSemaphore {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(signal: AbortSignal, operation: () => Promise<T>) {
        await this.acquire(signal);
        try {
            return await operation();
        } finally {
            this.release();
        }
    }

    private async acquire(signal: AbortSignal) {
        if (signal.aborted) throw abortError(signal);
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const resume = () => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            };
            const onAbort = () => {
                const index = this.waiters.indexOf(resume);
                if (index >= 0) this.waiters.splice(index, 1);
                reject(abortError(signal));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            this.waiters.push(resume);
        });
    }

    private release() {
        const next = this.waiters.shift();
        if (next) {
            next();
            return;
        }
        this.active = Math.max(0, this.active - 1);
    }
}

const PORT = positiveInt(process.env.PORT, 3000);
const DATA_DIR = resolve(process.env.DATA_DIR || "/data");
const WEB_ROOT = resolve(process.env.WEB_ROOT || "/app/web");
const JOB_FILE_ROOT = join(DATA_DIR, "job-files");
const ASSET_ROOT = join(DATA_DIR, "assets");
const PROMPT_CACHE_ROOT = join(DATA_DIR, "prompt-cache");
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_JOB_JSON_BYTES = 32 * 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_UPLOAD_BYTES = MAX_ASSET_BYTES + 256 * 1024;
const AVATAR_ASSET_KEY = "image:avatar";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_UPLOAD_BYTES = MAX_AVATAR_BYTES + 256 * 1024;
const MAX_USER_ASSET_BYTES = Math.max(MAX_ASSET_BYTES, positiveInt(process.env.MAX_USER_ASSET_BYTES, 2 * 1024 * 1024 * 1024));
const MAX_UPSTREAM_JSON_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES = Math.max(MAX_UPSTREAM_JSON_BYTES, Math.min(48 * 1024 * 1024, positiveInt(process.env.MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES, 48 * 1024 * 1024)));
const MAX_PROMPT_PROXY_BYTES = 20 * 1024 * 1024;
const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;
const JOB_RETENTION_MS = Math.max(60 * 60_000, positiveInt(process.env.JOB_RETENTION_MS, 30 * 24 * 60 * 60_000));
const MAX_TERMINAL_JOBS_PER_USER = Math.max(20, positiveInt(process.env.MAX_TERMINAL_JOBS_PER_USER, 200));
const GEMINI_IMAGE_CONCURRENCY = Math.max(1, Math.min(4, positiveInt(process.env.GEMINI_IMAGE_CONCURRENCY, 2)));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const JOB_CONCURRENCY = Math.max(1, Math.min(4, positiveInt(process.env.JOB_CONCURRENCY, 2)));
const REQUEST_TIMEOUT_MS = Math.max(30_000, positiveInt(process.env.UPSTREAM_TIMEOUT_MS, 10 * 60_000));
const UU_ASYNC_REQUEST_TIMEOUT_MS = Math.min(30_000, REQUEST_TIMEOUT_MS);
const UU_ASYNC_POLL_INTERVAL_MS = 2_500;
const UU_ASYNC_MAX_WAIT_MS = Math.max(UU_ASYNC_POLL_INTERVAL_MS, positiveInt(process.env.UU_ASYNC_MAX_WAIT_MS, 15 * 60_000));
const PROMPT_PROXY_CONCURRENCY = Math.max(1, Math.min(8, positiveInt(process.env.PROMPT_PROXY_CONCURRENCY, 3)));
const PROMPT_PROXY_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, positiveInt(process.env.PROMPT_PROXY_TIMEOUT_MS, 8_000)));
const PROMPT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/svg+xml", "image/bmp", "image/tiff"]);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim();
const secureCookies = PUBLIC_BASE_URL.startsWith("https://") || process.env.FORCE_SECURE_COOKIES === "1";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const RATE_BUCKET_LIMIT = Math.max(100, positiveInt(process.env.RATE_BUCKET_LIMIT, 10_000));

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JOB_FILE_ROOT, { recursive: true });
mkdirSync(ASSET_ROOT, { recursive: true });
mkdirSync(PROMPT_CACHE_ROOT, { recursive: true });

const appDatabase = openAppDatabase({ dataDir: DATA_DIR });
let state = appDatabase.loadState();
const assetBytesByUser = new Map<string, number>();
for (const asset of Object.values(state.assets)) assetBytesByUser.set(asset.userId, (assetBytesByUser.get(asset.userId) || 0) + asset.bytes);
const cultivation = appDatabase.raw ? createCultivationService(appDatabase.raw) : null;
for (const user of Object.values(state.users)) cultivation?.ensureUser(user.userId, Boolean(user.admin));
const configuredEncryptionSecret = process.env.APP_ENCRYPTION_KEY?.trim();
if (PUBLIC_BASE_URL.startsWith("https://") && !configuredEncryptionSecret) throw new Error("公网部署必须设置 APP_ENCRYPTION_KEY");
const encryptionSecret = configuredEncryptionSecret || state.auth.sessionSecret;
const previousEncryptionSecrets = (process.env.APP_ENCRYPTION_KEY_PREVIOUS || "").split(",").map((value) => value.trim()).filter(Boolean);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const requestClientIps = new WeakMap<Request, string>();
let stateWriteQueued = false;
let nextRateBucketSweepAt = 0;
let authMutation = Promise.resolve();
let assetMutation = Promise.resolve();
const geminiImageSemaphore = new AsyncSemaphore(GEMINI_IMAGE_CONCURRENCY);
const promptProxySemaphore = new AsyncSemaphore(PROMPT_PROXY_CONCURRENCY);

const imageQueue = new JobQueue<ImageJobInput, ImageJobOutput>({
    concurrency: JOB_CONCURRENCY,
    worker: runImageJob,
    onChange: (job) => {
        state.jobs[job.id] = job;
        writeState();
        if (["succeeded", "failed", "canceled"].includes(job.status)) pruneTerminalJobs();
    },
});

for (const job of Object.values(state.jobs)) {
    if (job.status === "running") {
        if (hasUuAsyncTask(job.input)) {
            job.status = "queued";
            job.error = undefined;
            job.finishedAt = undefined;
        } else {
            job.status = "failed";
            job.error = "服务器重启时任务仍在运行，为避免重复扣费，请手动重试";
            job.finishedAt = Date.now();
            cultivation?.refundGeneration(job.id, "server restarted while job was running");
        }
    }
    imageQueue.restore(job);
}
pruneTerminalJobs();
writeState();

let server: ReturnType<typeof Bun.serve>;
server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    idleTimeout: 255,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    async fetch(request) {
        const remoteAddress = server.requestIP(request)?.address || "unknown";
        requestClientIps.set(request, resolveClientIp(request, remoteAddress));
        const startedAt = Date.now();
        const requestId = randomUUID();
        let response: Response;
        try {
            response = await route(request, requestId);
        } catch (error) {
            response = errorResponse(error, requestId);
        }
        const secured = withSecurityHeaders(response, requestId);
        logRequest(request, secured, requestId, Date.now() - startedAt);
        return secured;
    },
});

console.info(JSON.stringify({ event: "server_started", port: server.port, dataDir: DATA_DIR, webRoot: WEB_ROOT, jobConcurrency: JOB_CONCURRENCY }));

async function route(request: Request, requestId: string) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok", version: 1 });
    if (url.pathname === "/config.js") return runtimeConfigResponse();
    if (url.pathname.startsWith("/prompt-proxy/")) {
        const session = requireSession(request);
        enforceRateLimit(`${session.userId}:${clientIp(request)}:prompt`, 180);
        return proxyPromptAsset(request, url, requestId);
    }
    if (url.pathname === "/api/auth/status") return authStatus(request);
    if (url.pathname === "/api/auth/setup" && request.method === "POST") return setupAuth(request);
    if (url.pathname === "/api/auth/login" && request.method === "POST") return login(request);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout();
    if (url.pathname.startsWith("/api/")) {
        enforceSameOrigin(request);
        const session = requireSession(request);
        enforceRateLimit(`${session.userId}:${clientIp(request)}`, request.method === "GET" ? 240 : 90);
        if (url.pathname === "/api/admin/metrics" && request.method === "GET") return adminMetrics(session);
        if (url.pathname === "/api/admin/users" && request.method === "GET") return listUsers(session);
        const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userMatch && request.method === "PUT") return updateUserAccess(request, session, userMatch[1]);
        if (url.pathname === "/api/cultivation/me" && request.method === "GET") return cultivationProfile(session);
        if (url.pathname === "/api/profile/avatar" && request.method === "POST") return uploadProfileAvatar(request, session);
        if (url.pathname === "/api/profile/avatar" && request.method === "DELETE") return deleteProfileAvatar(session);
        const seenBreakthroughMatch = url.pathname.match(/^\/api\/cultivation\/breakthroughs\/([^/]+)\/seen$/);
        if (seenBreakthroughMatch && request.method === "POST") return markCultivationBreakthroughSeen(session, seenBreakthroughMatch[1]);
        if (url.pathname === "/api/admin/cultivation/users" && request.method === "GET") return adminCultivationUsers(url, session);
        const cultivationUserMatch = url.pathname.match(/^\/api\/admin\/cultivation\/users\/([^/]+)$/);
        if (cultivationUserMatch && request.method === "PATCH") return adminUpdateCultivationUser(request, session, cultivationUserMatch[1]);
        const approveMatch = url.pathname.match(/^\/api\/admin\/cultivation\/users\/([^/]+)\/approve$/);
        if (approveMatch && request.method === "POST") return adminApproveBreakthrough(request, session, approveMatch[1]);
        if (url.pathname === "/api/admin/cultivation/config" && request.method === "GET") return adminCultivationConfiguration(session);
        const realmMatch = url.pathname.match(/^\/api\/admin\/cultivation\/realms\/([^/]+)$/);
        if (realmMatch && request.method === "PATCH") return adminUpdateRealm(request, session, realmMatch[1]);
        const stageMatch = url.pathname.match(/^\/api\/admin\/cultivation\/stages\/([^/]+)$/);
        if (stageMatch && request.method === "PATCH") return adminUpdateStage(request, session, stageMatch[1]);
        const capabilityMatch = url.pathname.match(/^\/api\/admin\/cultivation\/capabilities\/([^/]+)$/);
        if (capabilityMatch && request.method === "PATCH") return adminUpdateCapability(request, session, capabilityMatch[1]);
        if (url.pathname === "/api/admin/cultivation/rewards" && request.method === "PATCH") return adminUpdateRewards(request, session);
        if (url.pathname === "/api/admin/cultivation/ledger" && request.method === "GET") return adminCultivationLedger(url, session);
        if (url.pathname === "/api/admin/cultivation/usage" && request.method === "GET") return adminCultivationUsage(url, session);
        if (url.pathname === "/api/admin/cultivation/audit-logs" && request.method === "GET") return adminCultivationAuditLogs(url, session);
        if (url.pathname === "/api/admin/cultivation/login-logs" && request.method === "GET") return adminCultivationLoginLogs(url, session);
        if (url.pathname === "/api/admin/cultivation/breakthroughs" && request.method === "GET") return adminCultivationBreakthroughs(url, session);
        if (url.pathname === "/api/channels" && request.method === "GET") return listChannels(session);
        const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
        if (channelMatch && request.method === "PUT") return saveChannel(request, session, decodeURIComponent(channelMatch[1]));
        if (channelMatch && request.method === "DELETE") return deleteChannel(session, decodeURIComponent(channelMatch[1]));
        if (url.pathname === "/api/assets" && request.method === "POST") return uploadAsset(request, session);
        const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
        if (assetMatch && request.method === "GET") return serveAsset(session, decodeURIComponent(assetMatch[1]));
        if (assetMatch && request.method === "DELETE") return deleteAsset(session, decodeURIComponent(assetMatch[1]));
        if (url.pathname === "/api/jobs/images" && request.method === "POST") return createImageJob(request, session);
        if (url.pathname === "/api/jobs" && request.method === "GET") return listJobs(session);
        const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
        if (retryMatch && request.method === "POST") return retryJob(session, retryMatch[1]);
        const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch && request.method === "GET") return getJob(session, jobMatch[1]);
        if (jobMatch && request.method === "DELETE") return deleteJob(url, session, jobMatch[1]);
        const jobFileMatch = url.pathname.match(/^\/api\/job-files\/([^/]+)\/([^/]+)$/);
        if (jobFileMatch && request.method === "GET") return serveJobFile(session, jobFileMatch[1], jobFileMatch[2]);
        if (url.pathname === "/api/projects" && request.method === "GET") return json({ items: Object.values(state.projects[session.userId] || {}), deleted: Object.entries(state.projectTombstones[session.userId] || {}).map(([projectId, tombstone]) => ({ projectId, ...tombstone })) });
        const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (projectMatch && request.method === "PUT") return saveProject(request, session, projectMatch[1]);
        if (projectMatch && request.method === "DELETE") return deleteProject(url, session, projectMatch[1]);
        const proxyMatch = url.pathname.match(/^\/api\/ai\/([^/]+)\/(openai|gemini)\/(.*)$/);
        if (proxyMatch) return proxyAiRequest(request, session, decodeURIComponent(proxyMatch[1]), proxyMatch[2] as ProviderProtocol, `/${proxyMatch[3]}`, requestId);
        return json({ error: { message: "接口不存在" }, requestId }, 404);
    }
    return serveStatic(url.pathname, request.method);
}

async function authStatus(request: Request) {
    const candidate = optionalSession(request);
    const user = candidate ? state.users[candidate.userId] : undefined;
    const session = candidate && user && !isUserDisabled(user) ? candidate : null;
    return json({ configured: Boolean(state.auth.accessCodeHash), authenticated: Boolean(session), user: session && user ? publicAuthUser(user) : null, publicMode: true });
}

async function setupAuth(request: Request) {
    enforceRateLimit(`setup:${clientIp(request)}`, 10);
    const body = await readJson<{ accessCode?: string; displayName?: string; personalCode?: string }>(request);
    const accessCode = String(body.accessCode || "").trim();
    const displayName = normalizeDisplayName(body.displayName);
    const personalCode = normalizePersonalCode(body.personalCode, 10);
    if (accessCode.length < 8) return json({ error: { message: "访问口令至少 8 位" } }, 400);
    return withAuthMutation(async () => {
        if (state.auth.accessCodeHash) return json({ error: { message: "访问口令已经设置" } }, 409);
        const userId = randomUUID();
        state.auth.accessCodeHash = await hashAccessCode(accessCode);
        state.auth.adminUserId = userId;
        state.users[userId] = { userId, displayName, admin: true, status: "NORMAL", createdAt: Date.now(), loginHash: await hashAccessCode(personalCode) };
        writeState();
        cultivation?.ensureUser(userId, true);
        cultivation?.recordLogin({ userId, displayName, result: "setup-success", ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", secret: state.auth.sessionSecret });
        return authenticatedResponse(state.users[userId]);
    });
}

async function login(request: Request) {
    enforceRateLimit(`login:${clientIp(request)}`, 20);
    const body = await readJson<{ accessCode?: string; displayName?: string; personalCode?: string }>(request);
    const rawDisplayName = String(body.displayName || "").trim();
    const displayName = normalizeDisplayName(rawDisplayName);
    const personalCode = normalizePersonalCode(body.personalCode);
    return withAuthMutation(async () => {
        if (!state.auth.accessCodeHash) return json({ error: { message: "站点尚未初始化" } }, 409);
        if (!(await verifyAccessCode(String(body.accessCode || "").trim(), state.auth.accessCodeHash))) {
            cultivation?.recordLogin({ displayName: rawDisplayName || "unknown", result: "invalid-access-code", ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", secret: state.auth.sessionSecret });
            return json({ error: { message: "访问口令错误" } }, 401);
        }
        const identityUserId = readIdentityToken(readCookie(request, "canvas_identity"), state.auth.sessionSecret);
        const existing = Object.values(state.users).find((user) => sameDisplayName(user.displayName, displayName));
        if (existing && isUserDisabled(existing)) {
            cultivation?.recordLogin({ userId: existing.userId, displayName, result: "disabled", ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", secret: state.auth.sessionSecret });
            return json({ error: { message: "当前账号已停用" } }, 403);
        }
        if (existing?.loginHash && !(await verifyAccessCode(personalCode, existing.loginHash))) {
            cultivation?.recordLogin({ userId: existing.userId, displayName, result: "invalid-personal-code", ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", secret: state.auth.sessionSecret });
            return json({ error: { message: "个人密码错误" } }, 401);
        }
        if (existing && !existing.loginHash && existing.userId !== identityUserId) return json({ error: { message: "该旧账号尚未设置个人密码，请先在原设备登录后完成升级" } }, 409);
        const user = existing || { userId: randomUUID(), displayName, admin: false, status: "NORMAL" as const, createdAt: Date.now(), loginHash: await hashAccessCode(personalCode) };
        if (!user.loginHash) user.loginHash = await hashAccessCode(personalCode);
        user.disabled = false;
        user.status = "NORMAL";
        state.users[user.userId] = user;
        writeState();
        cultivation?.ensureUser(user.userId, Boolean(user.admin));
        cultivation?.recordLogin({ userId: user.userId, displayName: user.displayName, result: "success", ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", secret: state.auth.sessionSecret });
        return authenticatedResponse(user);
    });
}

function authenticatedResponse(user: UserRecord) {
    const token = createSessionToken(user, state.auth.sessionSecret, SESSION_TTL_MS);
    const identity = createIdentityToken(user.userId, state.auth.sessionSecret);
    const headers = new Headers();
    headers.append("Set-Cookie", sessionCookie(token, secureCookies));
    headers.append("Set-Cookie", identityCookie(identity, secureCookies));
    return json({ authenticated: true, user: publicAuthUser(user) }, 200, headers);
}

function publicAuthUser(user: UserRecord) {
    return { userId: user.userId, displayName: user.displayName, admin: Boolean(user.admin), avatarUrl: avatarUrlFor(user.userId) };
}

function logout() {
    const headers = new Headers();
    headers.append("Set-Cookie", expiredSessionCookie(secureCookies));
    headers.append("Set-Cookie", expiredIdentityCookie(secureCookies));
    return json({ ok: true }, 200, headers);
}

function optionalSession(request: Request) {
    return readSessionToken(readCookie(request, "canvas_session"), state.auth.sessionSecret);
}

function requireSession(request: Request) {
    const session = optionalSession(request);
    if (!session) throw new HttpError(401, "请先登录");
    const user = state.users[session.userId];
    if (!user || isUserDisabled(user)) throw new HttpError(403, "当前账号已停用");
    return session;
}

function listUsers(session: SessionPayload) {
    requireAdmin(session);
    return json({ items: Object.values(state.users).map(({ userId, displayName, admin, createdAt, disabled }) => ({ userId, displayName, admin: Boolean(admin), createdAt, disabled: Boolean(disabled) })) });
}

async function updateUserAccess(request: Request, session: SessionPayload, userId: string) {
    requireAdmin(session);
    const user = state.users[userId];
    if (!user) throw new HttpError(404, "成员不存在");
    if (user.admin) throw new HttpError(400, "不能停用管理员账号");
    const body = await readJson<{ disabled?: boolean }>(request);
    user.disabled = Boolean(body.disabled);
    user.status = user.disabled ? "DISABLED" : "NORMAL";
    writeState();
    return json({ user: { userId: user.userId, displayName: user.displayName, admin: Boolean(user.admin), createdAt: user.createdAt, disabled: Boolean(user.disabled) } });
}

function adminMetrics(session: SessionPayload) {
    requireAdmin(session);
    return json({ users: Object.keys(state.users).length, channels: Object.keys(state.channels).length, jobs: summarizeJobs(), uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage() });
}

function requireAdmin(session: SessionPayload) {
    if (!state.users[session.userId]?.admin) throw new HttpError(403, "仅管理员可以执行此操作");
}

function cultivationProfile(session: SessionPayload) {
    const service = requireCultivation();
    service.ensureUser(session.userId, Boolean(state.users[session.userId]?.admin));
    const { internalNote: _internalNote, ...profile } = service.getProfile(session.userId);
    return json({ profile: { ...profile, avatarUrl: avatarUrlFor(session.userId) } });
}

function markCultivationBreakthroughSeen(session: SessionPayload, breakthroughId: string) {
    requireCultivation().markBreakthroughSeen(session.userId, breakthroughId);
    return new Response(null, { status: 204 });
}

function adminCultivationUsers(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listUsers(page, pageSize, url.searchParams.get("search") || ""));
}

async function adminUpdateCultivationUser(request: Request, session: SessionPayload, encodedUserId: string) {
    requireAdmin(session);
    const userId = decodeURIComponent(encodedUserId);
    const body = await readJson<CultivationUserUpdate & { reason?: string }>(request);
    const profile = requireCultivation().updateUser(session.userId, userId, body, String(body.reason || ""));
    const user = state.users[userId];
    if (user) {
        if (body.status) {
            user.status = body.status;
            user.disabled = body.status !== "NORMAL";
        }
        if (body.internalNote !== undefined) user.internalNote = body.internalNote;
        if (body.publicMessage !== undefined) user.publicMessage = body.publicMessage;
        writeState();
    }
    return json({ profile });
}

async function adminApproveBreakthrough(request: Request, session: SessionPayload, encodedUserId: string) {
    requireAdmin(session);
    const body = await readJson<{ reason?: string }>(request);
    return json({ profile: requireCultivation().approveBreakthrough(session.userId, decodeURIComponent(encodedUserId), String(body.reason || "")) });
}

function adminCultivationConfiguration(session: SessionPayload) {
    requireAdmin(session);
    return json(requireCultivation().getConfiguration());
}

async function adminUpdateRealm(request: Request, session: SessionPayload, encodedRealmId: string) {
    requireAdmin(session);
    const body = await readJson<CultivationRealmUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateRealm(session.userId, decodeURIComponent(encodedRealmId), input, String(reason || "")));
}

async function adminUpdateStage(request: Request, session: SessionPayload, encodedStageId: string) {
    requireAdmin(session);
    const body = await readJson<CultivationStageUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateStage(session.userId, decodeURIComponent(encodedStageId), input, String(reason || "")));
}

async function adminUpdateCapability(request: Request, session: SessionPayload, encodedCapabilityKey: string) {
    requireAdmin(session);
    const body = await readJson<CultivationCapabilityUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateCapability(session.userId, decodeURIComponent(encodedCapabilityKey), input, String(reason || "")));
}

async function adminUpdateRewards(request: Request, session: SessionPayload) {
    requireAdmin(session);
    const body = await readJson<{ rewards?: Record<string, number>; reason?: string }>(request);
    return json(requireCultivation().updateRewards(session.userId, body.rewards || {}, String(body.reason || "")));
}

function adminCultivationLedger(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listLedger(url.searchParams.get("userId"), page, pageSize));
}

function adminCultivationUsage(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listGenerationUsage(url.searchParams.get("userId"), page, pageSize));
}

function adminCultivationAuditLogs(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listAuditLogs(page, pageSize));
}

function adminCultivationLoginLogs(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listLoginLogs(page, pageSize));
}

function adminCultivationBreakthroughs(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    return json(requireCultivation().listBreakthroughs(url.searchParams.get("userId"), page, pageSize));
}

function requireCultivation() {
    if (!cultivation) throw new HttpError(503, "SQLite 迁移尚未完成，修炼系统暂不可用");
    return cultivation;
}

function readPagination(url: URL) {
    return { page: Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1)), pageSize: Math.max(1, Math.min(50, Math.floor(Number(url.searchParams.get("pageSize")) || 20))) };
}

function listChannels(session: SessionPayload) {
    return json({
        items: Object.values(state.channels)
            .filter((channel) => channel.userId === session.userId)
            .map(({ apiKey: _apiKey, ...channel }) => ({ ...channel, hasApiKey: true })),
    });
}

async function saveChannel(request: Request, session: SessionPayload, id: string) {
    const body = await readJson<{ name?: string; baseUrl?: string; apiFormat?: ProviderProtocol; apiKey?: string }>(request);
    const baseUrl = String(body.baseUrl || "").trim();
    assertAllowedUpstreamUrl(baseUrl);
    const apiFormat: ProviderProtocol = body.apiFormat === "gemini" ? "gemini" : "openai";
    const key = channelKey(session.userId, id);
    const existing = state.channels[key];
    const plaintext = String(body.apiKey || "").trim();
    if (!plaintext && !existing) throw new HttpError(400, "首次保存渠道时必须填写 API Key");
    state.channels[key] = {
        id,
        userId: session.userId,
        name: String(body.name || existing?.name || "未命名渠道").trim().slice(0, 80),
        baseUrl,
        apiFormat,
        apiKey: plaintext ? encryptSecret(plaintext, encryptionSecret) : existing.apiKey,
        updatedAt: Date.now(),
    };
    writeState();
    return json({ ok: true, channel: { id, baseUrl, apiFormat, hasApiKey: true } });
}

function deleteChannel(session: SessionPayload, id: string) {
    delete state.channels[channelKey(session.userId, id)];
    writeState();
    return new Response(null, { status: 204 });
}

async function uploadAsset(request: Request, session: SessionPayload) {
    const { form, file } = await readAssetUploadForm(request, MAX_ASSET_UPLOAD_BYTES, MAX_ASSET_BYTES, "上传请求不能超过 16 MB", "单个素材不能超过 16 MB");
    const prefix = normalizeAssetPrefix(form.get("prefix"));
    const requestedKey = String(form.get("storageKey") || "").trim();
    const key = requestedKey || `${prefix}:${randomUUID()}`;
    if (!new RegExp(`^${escapeRegExp(prefix)}:[A-Za-z0-9._:-]{1,180}$`).test(key)) throw new HttpError(400, "素材标识无效");
    if (key === AVATAR_ASSET_KEY) throw new HttpError(400, "请通过个人头像入口上传头像");
    const mimeType = prefix.startsWith("image") ? await resolveImageMimeType(file) : String(file.type || "application/octet-stream").toLowerCase();
    if (prefix.startsWith("image") && !isAllowedImageMimeType(mimeType)) throw new HttpError(400, "图片素材格式无效，仅支持 PNG、JPEG、WebP 或 AVIF");
    const { asset, replaced } = await storeAsset(session, key, file, mimeType);
    return json({ asset: publicAsset(asset) }, replaced ? 200 : 201);
}

async function uploadProfileAvatar(request: Request, session: SessionPayload) {
    const { file } = await readAssetUploadForm(request, MAX_AVATAR_UPLOAD_BYTES, MAX_AVATAR_BYTES, "头像文件不能超过 2 MB", "头像文件不能超过 2 MB");
    const mimeType = await resolveImageMimeType(file);
    if (!isAllowedImageMimeType(mimeType)) throw new HttpError(400, "头像格式无效，仅支持 PNG、JPEG、WebP 或 AVIF");
    const { asset, replaced } = await storeAsset(session, AVATAR_ASSET_KEY, file, mimeType, true);
    return json({ asset: publicAsset(asset), avatarUrl: avatarUrlFor(session.userId) }, replaced ? 200 : 201);
}

async function deleteProfileAvatar(session: SessionPayload) {
    await removeAsset(session, AVATAR_ASSET_KEY);
    return json({ avatarUrl: "" });
}

async function readAssetUploadForm(request: Request, maxUploadBytes: number, maxFileBytes: number, uploadLimitMessage: string, fileLimitMessage: string) {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxUploadBytes) throw new HttpError(413, uploadLimitMessage);
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        throw new HttpError(400, "上传请求格式无效");
    }
    const file = form.get("file");
    if (!file || typeof file === "string" || file.size <= 0) throw new HttpError(400, "请选择需要上传的文件");
    if (file.size > maxFileBytes) throw new HttpError(413, fileLimitMessage);
    return { form, file };
}

async function storeAsset(session: SessionPayload, key: string, file: File, mimeType: string, refreshCreatedAt = false) {
    return withAssetMutation(async () => {
        const recordKey = assetKey(session.userId, key);
        const existing = state.assets[recordKey];
        const usedBytes = assetBytesByUser.get(session.userId) || 0;
        if (usedBytes - (existing?.bytes || 0) + file.size > MAX_USER_ASSET_BYTES) throw new HttpError(413, "服务端素材空间不足，请删除不再使用的素材");
        const directory = join(ASSET_ROOT, safeSegment(session.userId));
        mkdirSync(directory, { recursive: true });
        await Bun.write(join(directory, safeSegment(key)), file);
        const asset: StoredAsset = { key, userId: session.userId, mimeType, bytes: file.size, createdAt: refreshCreatedAt || !existing ? Date.now() : existing.createdAt };
        state.assets[recordKey] = asset;
        writeState();
        assetBytesByUser.set(session.userId, usedBytes - (existing?.bytes || 0) + asset.bytes);
        return { asset, replaced: Boolean(existing) };
    });
}

function serveAsset(session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    const path = join(ASSET_ROOT, safeSegment(session.userId), safeSegment(asset.key));
    if (!existsSync(path)) throw new HttpError(404, "素材文件不存在");
    return new Response(Bun.file(path), { headers: { "Content-Type": asset.mimeType, "Content-Length": String(asset.bytes), "Cache-Control": asset.key === AVATAR_ASSET_KEY ? "private, no-cache" : "private, max-age=31536000, immutable" } });
}

async function deleteAsset(session: SessionPayload, key: string) {
    await removeAsset(session, key);
    return new Response(null, { status: 204 });
}

async function removeAsset(session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    const path = join(ASSET_ROOT, safeSegment(session.userId), safeSegment(asset.key));
    return withAssetMutation(async () => {
        delete state.assets[assetKey(session.userId, key)];
        writeState();
        assetBytesByUser.set(session.userId, Math.max(0, (assetBytesByUser.get(session.userId) || 0) - asset.bytes));
        try {
            if (existsSync(path)) unlinkSync(path);
        } catch (error) {
            console.warn(JSON.stringify({ event: "asset_file_cleanup_failed", key: asset.key, message: error instanceof Error ? error.message : "unknown error" }));
        }
    });
}

function publicAsset(asset: StoredAsset) {
    return { key: asset.key, url: assetUrl(asset.key), mimeType: asset.mimeType, bytes: asset.bytes, createdAt: asset.createdAt };
}

function avatarUrlFor(userId: string) {
    const asset = state.assets[assetKey(userId, AVATAR_ASSET_KEY)];
    return asset ? `${assetUrl(asset.key)}?v=${asset.createdAt}` : "";
}

function assetUrl(key: string) {
    return `/api/assets/${encodeURIComponent(key)}`;
}

async function createImageJob(request: Request, session: SessionPayload) {
    const body = await readJson<Partial<ImageJobInput>>(request, MAX_IMAGE_JOB_JSON_BYTES);
    const channelId = String(body.channelId || "");
    const channel = ownedChannel(session.userId, channelId);
    const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)));
    const references = Array.isArray(body.references) ? body.references.map(String) : [];
    if (references.length > 16) throw new HttpError(400, "参考图最多 16 张");
    references.forEach(assertSafeDataImage);
    if (body.mask) assertSafeDataImage(String(body.mask));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new HttpError(400, "提示词不能为空");
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "幂等请求标识无效");
    const jobId = idempotencyKey ? createHash("sha256").update(`${session.userId}:${idempotencyKey}`).digest("hex") : randomUUID();
    if (idempotencyKey) {
        const existing = state.jobs[jobId];
        if (existing) return json({ job: publicJob(existing) }, 200);
    }
    const model = String(body.model || "").trim();
    if (!model) throw new HttpError(400, "模型不能为空");
    const resolution = optionalString(body.quality);
    const isUuGptImage2 = isUuAsyncGptImage2Channel(channel.baseUrl, model);
    const imageQuality = isUuGptImage2 ? undefined : normalizeImageQuality(body.imageQuality);
    const imageOutputFormat = isUuGptImage2 ? undefined : normalizeImageOutputFormat(body.imageOutputFormat, model);
    cultivation?.reserveGeneration({ jobId, userId: session.userId, channelId, model, count, quality: resolution, referenceCount: references.length, hasMask: Boolean(body.mask), activeJobs: activeUserJobs(session.userId) });
    try {
        const input: ImageJobInput = {
            userId: session.userId,
            channelId,
            apiFormat: channel.apiFormat,
            model,
            prompt,
            count,
            quality: resolution,
            imageQuality,
            imageOutputFormat,
            size: optionalString(body.size),
            background: optionalString(body.background),
            references: references.map((reference, index) => persistReference(DATA_DIR, session.userId, jobId, index, reference)),
            mask: body.mask ? persistReference(DATA_DIR, session.userId, jobId, 10_000, String(body.mask)) : undefined,
            source: normalizeJobSource(body.source),
        };
        const job = imageQueue.add(input, jobId);
        return json({ job: publicJob(job) }, 202);
    } catch (error) {
        cultivation?.refundGeneration(jobId, "job creation failed");
        throw error;
    }
}

function listJobs(session: SessionPayload) {
    return json({ items: imageQueue.list().filter((job) => job.input.userId === session.userId).map(publicJob) });
}

function getJob(session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    return json({ job: publicJob(job) });
}

async function retryJob(session: SessionPayload, id: string) {
    const source = ownedJob(session.userId, id);
    if (["queued", "running"].includes(source.status)) throw new HttpError(409, "任务仍在运行");
    const jobId = randomUUID();
    cultivation?.reserveGeneration({ jobId, userId: session.userId, channelId: source.input.channelId, model: source.input.model, count: source.input.count, quality: source.input.quality, referenceCount: source.input.references.length, hasMask: Boolean(source.input.mask), activeJobs: activeUserJobs(session.userId) });
    try {
        const input = await copyImageJobInputForRetry(source.input, jobId);
        const job = imageQueue.add(input, jobId);
        return json({ job: publicJob(job) }, 202);
    } catch (error) {
        cleanupJobFilesFor(session.userId, jobId);
        cultivation?.refundGeneration(jobId, "retry job creation failed");
        throw error;
    }
}

async function copyImageJobInputForRetry(input: ImageJobInput, jobId: string): Promise<ImageJobInput> {
    const references = await Promise.all(
        input.references.map(async (reference, index) =>
            persistReference(DATA_DIR, input.userId, jobId, index, await materializeStoredImage(reference)),
        ),
    );
    const mask = input.mask
        ? persistReference(DATA_DIR, input.userId, jobId, 10_000, await materializeStoredImage(input.mask))
        : undefined;
    return { ...input, references, mask, upstream: undefined };
}

async function deleteJob(url: URL, session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    if (["queued", "running"].includes(job.status)) {
        if (imageQueue.cancel(id)) {
            cultivation?.refundGeneration(id, "user canceled");
            void cancelUuImageTask(job.input).catch((error) => console.warn(JSON.stringify({ event: "uu_async_cancel_failed", jobId: id, message: error instanceof Error ? error.message : "unknown error" })));
        }
        return json({ job: publicJob(imageQueue.get(id)!) });
    }
    if (url.searchParams.get("remove") === "1") {
        if (!imageQueue.remove(id)) throw new HttpError(409, "任务仍在运行，无法移除");
        delete state.jobs[id];
        writeState();
        cleanupJobFiles(job);
        return new Response(null, { status: 204 });
    }
    return json({ job: publicJob(job) });
}

function publicJob(job: StoredImageJob) {
    return {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        prompt: job.input.prompt,
        model: job.input.model,
        count: job.input.count,
        source: job.input.source,
        result: job.result,
    };
}

async function runImageJob(input: ImageJobInput, signal: AbortSignal, job: QueueJob<ImageJobInput, ImageJobOutput>) {
    const startedAt = Date.now();
    try {
        const channel = ownedChannel(input.userId, input.channelId);
        const apiKey = decryptChannelApiKey(channel);
        const useUuAsync = input.apiFormat === "openai" && (hasUuAsyncTask(input) || (input.count === 1 && isUuImageAsyncChannel(channel.baseUrl, input.model, input.references.length, Boolean(input.mask))));
        const rawImages =
            input.apiFormat === "gemini"
                ? await generateGeminiImages(channel, apiKey, await materializeImageInput(input), signal)
                : useUuAsync
                  ? await generateUuAsyncImages(channel, apiKey, input, job, signal)
                  : await generateOpenAiImages(channel, apiKey, await materializeImageInput(input), signal);
        const images: ImageJobImage[] = [];
        for (const raw of rawImages) {
            if (signal.aborted || job.status === "canceled") throw abortError(signal);
            images.push(await persistJobImage(input.userId, job.id, raw, Date.now() - startedAt, signal));
        }
        if (!images.length) throw new Error("上游接口没有返回图片");
        const result = { images, successCount: images.length, failCount: Math.max(0, input.count - images.length), durationMs: Date.now() - startedAt };
        cultivation?.settleGeneration({ jobId: job.id, successCount: result.successCount, failCount: result.failCount, durationMs: result.durationMs });
        return result;
    } catch (error) {
        if (job.status !== "canceled") cultivation?.refundGeneration(job.id, error instanceof Error ? error.message : "generation failed");
        throw error;
    }
}

async function materializeImageInput(input: ImageJobInput): Promise<RuntimeImageJobInput> {
    return { ...input, references: await Promise.all(input.references.map(materializeStoredImage)), mask: input.mask ? await materializeStoredImage(input.mask) : undefined };
}

async function materializeStoredImage(reference: string | StoredImageReference) {
    if (typeof reference === "string") return reference;
    const path = resolve(DATA_DIR, reference.path);
    if (!(path === DATA_DIR || path.startsWith(`${DATA_DIR}${sep}`)) || !existsSync(path)) throw new HttpError(404, "参考图文件不存在");
    const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
    return `data:${reference.mimeType};base64,${bytes.toString("base64")}`;
}

type RuntimeImageJobInput = Omit<ImageJobInput, "references" | "mask"> & { references: string[]; mask?: string };

async function generateOpenAiImages(channel: ChannelRecord, apiKey: string, input: RuntimeImageJobInput, signal: AbortSignal) {
    const headers = { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": randomUUID() };
    const size = resolveOpenAiImageSize(input.size, input.quality);
    const requestOptions = buildOpenAiImageRequestOptions({ count: input.count, quality: input.imageQuality, outputFormat: input.imageOutputFormat, size, background: input.background });
    let response: Response;
    if (input.references.length) {
        const form = new FormData();
        form.set("model", input.model);
        form.set("prompt", input.prompt);
        Object.entries(requestOptions).forEach(([key, value]) => form.set(key, String(value)));
        input.references.forEach((dataUrl, index) => form.append("image", dataUrlBlob(dataUrl), `reference-${index + 1}.png`));
        if (input.mask) form.set("mask", dataUrlBlob(input.mask), "mask.png");
        response = await upstreamFetch(buildUpstreamUrl(channel.baseUrl, "openai", "/images/edits"), { method: "POST", headers, body: form, signal }, true);
    } else {
        response = await upstreamFetch(
            buildUpstreamUrl(channel.baseUrl, "openai", "/images/generations"),
            {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: input.model,
                    prompt: input.prompt,
                    ...requestOptions,
                }),
                signal,
            },
            true,
        );
    }
    const payload = await parseUpstreamJson(response, { maxBytes: MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES, tooLargeMessage: "上游内嵌图片响应过大，请将单次生成张数调低后重试" });
    const data = Array.isArray(payload.data) ? payload.data : [];
    const mimeType = imageOutputFormatMimeType(input.imageOutputFormat);
    return data.map((item) => (typeof item?.b64_json === "string" ? base64ImageDataUrl(item.b64_json, mimeType) : typeof item?.url === "string" ? item.url : "")).filter(Boolean);
}

async function generateUuAsyncImages(channel: ChannelRecord, apiKey: string, input: ImageJobInput, job: QueueJob<ImageJobInput, ImageJobOutput>, signal: AbortSignal) {
    if (!hasUuAsyncTask(input)) {
        const runtimeInput = await materializeImageInput(input);
        const requestOptions = buildUuAsyncImageRequest({ size: input.size, quality: input.quality, referenceCount: runtimeInput.references.length });
        const form = new FormData();
        form.set("model", input.model);
        form.set("mode", requestOptions.mode);
        form.set("prompt", input.prompt);
        form.set("width", String(requestOptions.width));
        form.set("height", String(requestOptions.height));
        if (runtimeInput.references[0]) form.set("image", dataUrlBlob(runtimeInput.references[0]), "reference.png");

        const response = await upstreamFetch(
            buildUpstreamUrl(channel.baseUrl, "openai", "/images/generations/async"),
            { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": randomUUID() }, body: form, signal },
            true,
            UU_ASYNC_REQUEST_TIMEOUT_MS,
        );
        const task = readUuAsyncTask(await parseUpstreamJson(response));
        if (!task.taskId) throw new Error(task.message || "UU 异步任务创建成功，但没有返回任务 ID");
        input.upstream = { provider: "uu-image", taskId: task.taskId, expiresAt: task.expiresAt, status: task.status };
        await imageQueue.touch(job.id);
        writeState();
    }
    return pollUuImageTask(channel, apiKey, input, signal);
}

async function pollUuImageTask(channel: ChannelRecord, apiKey: string, input: ImageJobInput, signal: AbortSignal) {
    if (!hasUuAsyncTask(input)) throw new Error("UU 异步任务 ID 丢失");
    const taskUrl = buildUpstreamUrl(channel.baseUrl, "openai", `/images/generations/tasks/${encodeURIComponent(input.upstream.taskId)}`);
    const expiresAt = Date.parse(input.upstream.expiresAt || "");
    const deadline = Math.min(Date.now() + UU_ASYNC_MAX_WAIT_MS, Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY);
    while (!signal.aborted) {
        if (Date.now() >= deadline) throw new Error("UU 异步生图等待超时，请稍后在任务中心重试");
        const response = await upstreamFetch(taskUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal }, true, UU_ASYNC_REQUEST_TIMEOUT_MS);
        const task = readUuAsyncTask(await parseUpstreamJson(response));
        input.upstream.status = task.status;
        input.upstream.expiresAt = task.expiresAt || input.upstream.expiresAt;
        if (task.status === "succeeded") {
            if (!task.imageUrls.length) throw new Error(task.message || "UU 异步任务完成，但没有返回图片");
            return task.imageUrls;
        }
        if (task.status === "failed") throw new Error(task.message || "UU 异步任务失败");
        if (task.status === "canceled") throw new Error(task.message || "UU 异步任务已取消");
        if (task.status === "unknown") throw new Error(task.message || "UU 异步任务返回了无法识别的状态");
        await waitForAbortableDelay(UU_ASYNC_POLL_INTERVAL_MS, signal);
    }
    throw abortError(signal);
}

async function cancelUuImageTask(input: ImageJobInput) {
    if (!hasUuAsyncTask(input)) return;
    const channel = ownedChannel(input.userId, input.channelId);
    const apiKey = decryptChannelApiKey(channel);
    const response = await upstreamFetch(
        buildUpstreamUrl(channel.baseUrl, "openai", `/images/generations/tasks/${encodeURIComponent(input.upstream.taskId)}`),
        { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } },
        false,
        UU_ASYNC_REQUEST_TIMEOUT_MS,
    );
    await response.body?.cancel();
}

function hasUuAsyncTask(input: ImageJobInput): input is ImageJobInput & { upstream: NonNullable<ImageJobInput["upstream"]> } {
    return input.upstream?.provider === "uu-image" && Boolean(input.upstream.taskId);
}

function waitForAbortableDelay(milliseconds: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = () => finish(() => reject(abortError(signal)));
        timeout = setTimeout(() => finish(resolve), milliseconds);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
    });
}

function abortError(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new Error("任务已取消");
}

async function generateGeminiImages(channel: ChannelRecord, apiKey: string, input: RuntimeImageJobInput, signal: AbortSignal) {
    const outputs = await Promise.all(
        Array.from({ length: input.count }, async () => {
            return geminiImageSemaphore.run(signal, async () => {
            const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
            input.references.forEach((dataUrl) => {
                const parsed = parseDataUrl(dataUrl);
                parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
            });
            const image: Record<string, string> = {};
            if (input.size && input.size !== "auto") image.aspectRatio = normalizeAspectRatio(input.size);
            if (input.quality && input.quality !== "auto") image.imageSize = ({ low: "1K", medium: "2K", high: "4K" } as Record<string, string>)[input.quality] || input.quality;
            const response = await upstreamFetch(
                buildUpstreamUrl(channel.baseUrl, "gemini", `/models/${encodeURIComponent(input.model.replace(/^models\//, ""))}:generateContent`),
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, "Idempotency-Key": randomUUID() },
                    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(image).length ? { responseFormat: { image } } : {}) } }),
                    signal,
                },
                true,
            );
            const payload = await parseUpstreamJson(response, { maxBytes: MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES, tooLargeMessage: "上游内嵌图片响应过大，请将单次生成张数调低后重试" });
            return (Array.isArray(payload.candidates) ? payload.candidates : [])
                .flatMap((candidate) => candidate?.content?.parts || [])
                .map((part) => {
                    const inline = part?.inlineData || part?.inline_data;
                    if (inline?.data) return `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}`;
                    return part?.fileData?.fileUri || "";
                })
                .filter(Boolean);
            });
        }),
    );
    return outputs.flat();
}

async function persistJobImage(userId: string, jobId: string, value: string, durationMs: number, signal: AbortSignal): Promise<ImageJobImage> {
    if (signal.aborted) throw abortError(signal);
    let bytes: Uint8Array;
    let mimeType = "image/png";
    if (value.startsWith("data:")) {
        const parsed = parseDataUrl(value);
        bytes = Buffer.from(parsed.base64, "base64");
        mimeType = parsed.mimeType;
    } else {
        assertAllowedUpstreamUrl(value);
        const response = await upstreamFetch(value, { signal }, false);
        if (!response.ok) throw new Error(`下载生成图片失败：${response.status}`);
        bytes = await readResponseBytes(response, MAX_UPSTREAM_IMAGE_BYTES, "上游返回图片过大");
        mimeType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "";
        if (!isAllowedImageMimeType(mimeType)) mimeType = detectImageMimeFromBytes(bytes);
    }
    const detectedMimeType = detectImageMimeFromBytes(bytes);
    if (!isAllowedImageMimeType(detectedMimeType) || bytes.byteLength > MAX_UPSTREAM_IMAGE_BYTES) throw new Error("上游返回的图片格式或大小不受支持");
    mimeType = detectedMimeType;
    if (signal.aborted) throw abortError(signal);
    const extension = imageExtension(mimeType);
    const filename = `${randomUUID()}${extension}`;
    const directory = join(JOB_FILE_ROOT, safeSegment(userId), safeSegment(jobId));
    mkdirSync(directory, { recursive: true });
    await Bun.write(join(directory, filename), bytes);
    if (signal.aborted) {
        unlinkSync(join(directory, filename));
        throw abortError(signal);
    }
    return { id: randomUUID(), dataUrl: `/api/job-files/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`, bytes: bytes.byteLength, durationMs, mimeType };
}

function serveJobFile(session: SessionPayload, jobId: string, filename: string) {
    ownedJob(session.userId, jobId);
    const safeName = safeSegment(filename);
    const path = join(JOB_FILE_ROOT, safeSegment(session.userId), safeSegment(jobId), safeName);
    const file = Bun.file(path);
    if (!existsSync(path)) throw new HttpError(404, "图片不存在");
    return new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" } });
}

async function proxyAiRequest(request: Request, session: SessionPayload, channelId: string, protocol: ProviderProtocol, path: string, requestId: string) {
    const channel = ownedChannel(session.userId, channelId);
    if (channel.apiFormat !== protocol) throw new HttpError(400, "渠道协议不匹配");
    assertAllowedProxyRequest(request.method, protocol, path);
    const apiKey = decryptChannelApiKey(channel);
    const target = buildUpstreamUrl(channel.baseUrl, protocol, path);
    const headers = new Headers();
    for (const name of ["content-type", "accept", "idempotency-key"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    const idempotencyKey = headers.get("idempotency-key");
    if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "幂等键格式无效");
    if (protocol === "gemini") headers.set("x-goog-api-key", apiKey);
    else headers.set("authorization", `Bearer ${apiKey}`);
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readRequestBytes(request, MAX_PROXY_BODY_BYTES, "代理请求内容过大");
    const response = await upstreamFetch(`${target}${new URL(request.url).search}`, { method: request.method, headers, body, signal: request.signal }, Boolean(headers.get("idempotency-key")));
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-disposition", "cache-control"]) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("x-request-id", requestId);
    responseHeaders.set("x-upstream-status", String(response.status));
    return new Response(response.body, { status: response.status, headers: responseHeaders });
}

function assertAllowedProxyRequest(method: string, protocol: ProviderProtocol, path: string) {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = `/${path.replace(/^\/+/, "")}`;
    const openAiReadPath = /^\/(?:models(?:\/[^/]+)?|videos\/[^/]+(?:\/content)?|contents\/generations\/tasks(?:\/[^/]+)?)$/;
    const openAiWritePath = /^\/(?:audio\/speech|videos|contents\/generations\/tasks)$/;
    const geminiReadPath = /^\/models(?:\/[^/]+)?$/;
    const allowed = protocol === "gemini"
        ? ["GET", "HEAD"].includes(normalizedMethod) && geminiReadPath.test(normalizedPath)
        : (["GET", "HEAD"].includes(normalizedMethod) && openAiReadPath.test(normalizedPath)) || (normalizedMethod === "POST" && openAiWritePath.test(normalizedPath));
    if (!allowed) throw new HttpError(403, "该渠道请求必须通过受控任务接口执行");
}

async function saveProject(request: Request, session: SessionPayload, id: string) {
    const body = await readJson<{ project?: Record<string, unknown>; revision?: number }>(request, 8 * 1024 * 1024);
    if (!isValidProjectPayload(body.project, id)) throw new HttpError(400, "项目数据无效");
    const projects = (state.projects[session.userId] ||= {});
    const tombstone = state.projectTombstones[session.userId]?.[id];
    if (tombstone) return json({ error: { message: "画布已删除，请新建画布后继续编辑", code: "PROJECT_DELETED" }, tombstone }, 409);
    const current = projects[id];
    if (current && Number(body.revision) !== current.revision) return json({ error: { message: "项目已在其他标签页更新", code: "REVISION_CONFLICT" }, current }, 409);
    const next = { project: body.project, revision: (current?.revision || 0) + 1, updatedAt: Date.now() };
    projects[id] = next;
    writeState();
    return json(next);
}

function deleteProject(url: URL, session: SessionPayload, id: string) {
    const projects = state.projects[session.userId];
    const current = projects?.[id];
    const requestedRevision = Number(url.searchParams.get("revision") || 0);
    if (current && requestedRevision && requestedRevision !== current.revision) return json({ error: { message: "画布已在其他位置更新", code: "REVISION_CONFLICT" }, current }, 409);
    if (projects) delete projects[id];
    const tombstones = (state.projectTombstones[session.userId] ||= {});
    const previous = tombstones[id];
    tombstones[id] = { revision: Math.max(current?.revision || 0, previous?.revision || 0) + 1, deletedAt: Date.now() };
    writeState();
    return new Response(null, { status: 204 });
}

async function upstreamFetch(url: string, init: RequestInit, retryable: boolean, timeoutMs = REQUEST_TIMEOUT_MS) {
    const attempts = retryable || ["GET", "HEAD"].includes(init.method || "GET") ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        try {
            const response = await fetchAllowedRedirects(url, { ...init, signal });
            if (![502, 503, 504, 524].includes(response.status) || attempt === attempts - 1) return response;
            await response.body?.cancel();
        } catch (error) {
            lastError = error;
            if (attempt === attempts - 1 || init.signal?.aborted) throw error;
        }
        await Bun.sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
    throw lastError || new Error("上游请求失败");
}

async function fetchAllowedRedirects(url: string, init: RequestInit) {
    let current = assertAllowedUpstreamUrl(url);
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const hasCredentials = headers.has("authorization") || headers.has("x-goog-api-key");
    for (let redirects = 0; redirects <= 4; redirects += 1) {
        current = await assertResolvedPublicUpstreamUrl(current);
        const response = await fetch(current, { ...init, redirect: "manual" });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        if (!location) return response;
        await response.body?.cancel();
        if (!["GET", "HEAD"].includes(method)) throw new HttpError(502, "上游接口发生重定向，请在渠道配置中填写最终 HTTPS 地址");
        const next = resolveAllowedRedirect(current, location);
        if (hasCredentials && next.origin !== current.origin) throw new HttpError(502, "上游接口试图把鉴权信息重定向到其他域名，已拒绝请求");
        current = next;
    }
    throw new HttpError(502, "上游接口重定向次数过多");
}

async function parseUpstreamJson(response: Response, options: { maxBytes?: number; tooLargeMessage?: string } = {}): Promise<any> {
    const maxBytes = options.maxBytes || MAX_UPSTREAM_JSON_BYTES;
    const tooLargeMessage = options.tooLargeMessage || "上游 JSON 响应过大";
    const text = new TextDecoder().decode(await readResponseBytes(response, maxBytes, tooLargeMessage));
    let payload: any = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        if (!response.ok) throw new Error(`上游服务返回 ${response.status}：${text.slice(0, 200)}`);
    }
    if (!response.ok || payload?.error?.message || (typeof payload?.code === "number" && payload.code !== 0)) {
        throw new Error(payload?.error?.message || payload?.msg || `上游服务返回 ${response.status}`);
    }
    return payload;
}

async function proxyPromptAsset(request: Request, url: URL, requestId: string) {
    const target = promptProxyTarget(url.pathname, url.search);
    if (!target) throw new HttpError(404, "不支持的提示词资源地址");
    const cacheKey = createHash("sha256").update(target).digest("hex");
    const cachePath = join(PROMPT_CACHE_ROOT, cacheKey);
    if (isFreshPromptCache(cachePath)) return promptCachedResponse(cachePath, requestId);
    try {
        return await promptProxySemaphore.run(request.signal, async () => {
            if (isFreshPromptCache(cachePath)) return promptCachedResponse(cachePath, requestId);
            const response = await upstreamFetch(target, { headers: { "User-Agent": "InfiniteCanvas/1.0" }, signal: request.signal }, false, PROMPT_PROXY_TIMEOUT_MS);
            if (!response.ok) throw new HttpError(response.status, `提示词资源加载失败：${response.status}`);
            const bytes = await readResponseBytes(response, MAX_PROMPT_PROXY_BYTES, "提示词资源过大");
            const contentType = promptAssetContentType(response.headers.get("content-type"), bytes);
            await Promise.all([
                Bun.write(cachePath, bytes),
                Bun.write(`${cachePath}.meta.json`, JSON.stringify({ contentType })),
            ]);
            return new Response(bytes, { headers: promptCacheHeaders(contentType, requestId) });
        });
    } catch (error) {
        if (existsSync(cachePath)) return promptCachedResponse(cachePath, requestId, true);
        throw error;
    }
}

function isFreshPromptCache(path: string) {
    return existsSync(path) && Date.now() - Bun.file(path).lastModified < 7 * 24 * 60 * 60 * 1000;
}

async function promptCachedResponse(path: string, requestId: string, stale = false) {
    const file = Bun.file(path);
    const contentType = await promptCacheContentType(path, file);
    return new Response(file, { headers: promptCacheHeaders(contentType, requestId, stale) });
}

function promptCacheHeaders(contentType: string, requestId: string, stale = false) {
    return {
        "Content-Type": contentType,
        "Cache-Control": stale ? "public, max-age=60, stale-while-revalidate=86400" : "public, max-age=604800, stale-while-revalidate=86400",
        "x-request-id": requestId,
    };
}

async function promptCacheContentType(path: string, file: Blob) {
    try {
        const metadata = (await Bun.file(`${path}.meta.json`).json()) as { contentType?: unknown };
        const contentType = String(metadata.contentType || "").toLowerCase();
        if (PROMPT_IMAGE_MIME_TYPES.has(contentType)) return contentType;
    } catch {
        // Older cache entries have no sidecar metadata. Fall back to the signature.
    }
    return promptAssetContentType("", new Uint8Array(await file.slice(0, 64).arrayBuffer()));
}

function promptAssetContentType(header: string | null, bytes: Uint8Array) {
    const detected = detectImageMimeFromBytes(bytes);
    if (detected) return detected;
    const declared = String(header || "").split(";", 1)[0].trim().toLowerCase();
    return PROMPT_IMAGE_MIME_TYPES.has(declared) ? declared : "application/octet-stream";
}

function promptProxyTarget(pathname: string, search: string) {
    const raw = pathname.match(/^\/prompt-proxy\/raw\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (raw) return `https://cdn.jsdelivr.net/gh/${raw[1]}/${raw[2]}@${raw[3]}/${raw[4]}${search}`;
    const targets: Array<[RegExp, string]> = [
        [/^\/prompt-proxy\/thumbnail\/(.*)$/, "https://images.weserv.nl/"],
        [/^\/prompt-proxy\/pbs\/(.*)$/, "https://pbs.twimg.com/"],
        [/^\/prompt-proxy\/shields\/(.*)$/, "https://img.shields.io/"],
        [/^\/prompt-proxy\/star-history\/(.*)$/, "https://api.star-history.com/"],
        [/^\/prompt-proxy\/awesome\/(.*)$/, "https://awesome.re/"],
        [/^\/prompt-proxy\/atomgit\/(.*)$/, "https://atomgit.com/"],
    ];
    for (const [pattern, base] of targets) {
        const match = pathname.match(pattern);
        if (match) return `${base}${match[1]}${search}`;
    }
    return "";
}

async function serveStatic(pathname: string, method: string) {
    if (!["GET", "HEAD"].includes(method)) return new Response(null, { status: 405 });
    const decoded = decodeURIComponent(pathname);
    const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    let path = resolve(WEB_ROOT, relative || "index.html");
    if (!(path === WEB_ROOT || path.startsWith(`${WEB_ROOT}${sep}`)) || !existsSync(path) || Bun.file(path).size === 0) path = join(WEB_ROOT, "index.html");
    const file = Bun.file(path);
    const immutable = /\.[a-f0-9]{8,}\.(?:js|css|woff2?|svg)$/i.test(path);
    return new Response(method === "HEAD" ? null : file, { headers: { "Content-Type": file.type || contentType(path), "Cache-Control": immutable ? "public, max-age=31536000, immutable" : path.endsWith("index.html") ? "no-cache" : "public, max-age=3600" } });
}

function runtimeConfigResponse() {
    const config = {
        ANALYTICS_GA4_ID: sanitizeId(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: sanitizeId(process.env.ANALYTICS_BAIDU_ID),
        PUBLIC_MODE: true,
    };
    return new Response(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};`, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}

function withSecurityHeaders(response: Response, requestId: string) {
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("x-request-id", requestId);
    headers.set(
        "content-security-policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.googletagmanager.com https://hm.baidu.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https://www.google-analytics.com https://hm.baidu.com; font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'",
    );
    if (secureCookies) headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(error: unknown, requestId: string) {
    const status = error instanceof HttpError || error instanceof CultivationError ? error.status : error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    const message = error instanceof Error ? error.message : "服务器内部错误";
    console.error(JSON.stringify({ event: "request_error", requestId, status, message, stack: error instanceof Error ? error.stack : undefined }));
    return json({ error: { message }, requestId }, status);
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
    return Response.json(value, { status, headers });
}

async function readJson<T>(request: Request, maxBytes = MAX_JSON_BYTES): Promise<T> {
    const text = new TextDecoder().decode(await readRequestBytes(request, maxBytes, "请求内容过大"));
    try {
        return (text ? JSON.parse(text) : {}) as T;
    } catch {
        throw new HttpError(400, "JSON 格式无效");
    }
}

function enforceSameOrigin(request: Request) {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.get("origin");
    if (!origin) return;
    if (new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, "跨站请求已拒绝");
}

function enforceRateLimit(key: string, limit: number) {
    const now = Date.now();
    if (now >= nextRateBucketSweepAt || rateBuckets.size >= RATE_BUCKET_LIMIT) {
        for (const [bucketKey, value] of rateBuckets) {
            if (value.resetAt <= now || rateBuckets.size >= RATE_BUCKET_LIMIT) rateBuckets.delete(bucketKey);
        }
        nextRateBucketSweepAt = now + 60_000;
    }
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
        return;
    }
    bucket.count += 1;
    if (bucket.count > limit) throw new HttpError(429, "请求过于频繁，请稍后再试");
}

async function readRequestBytes(request: Request, maxBytes: number, message: string) {
    const length = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > maxBytes) throw new HttpError(413, message);
    return readStreamBytes(request.body, maxBytes, message);
}

async function readResponseBytes(response: Response, maxBytes: number, message: string) {
    const length = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > maxBytes) {
        await response.body?.cancel();
        throw new HttpError(413, message);
    }
    return readStreamBytes(response.body, maxBytes, message);
}

async function readStreamBytes(stream: ReadableStream<Uint8Array> | null, maxBytes: number, message: string) {
    if (!stream) return new Uint8Array();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader.cancel(message);
                throw new HttpError(413, message);
            }
            chunks.push(next.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

function clientIp(request: Request) {
    return requestClientIps.get(request) || "unknown";
}

function resolveClientIp(request: Request, remoteAddress: string) {
    if (!TRUST_PROXY) return remoteAddress;
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded && isIP(forwarded) ? forwarded : remoteAddress;
}

async function withAuthMutation<T>(operation: () => Promise<T>) {
    const previous = authMutation;
    let release = () => undefined;
    authMutation = new Promise<void>((resolve) => {
        release = resolve;
    });
    await previous;
    try {
        return await operation();
    } finally {
        release();
    }
}

async function withAssetMutation<T>(operation: () => Promise<T>) {
    const previous = assetMutation;
    let release = () => undefined;
    assetMutation = new Promise<void>((resolve) => {
        release = resolve;
    });
    await previous;
    try {
        return await operation();
    } finally {
        release();
    }
}

function normalizeDisplayNameKey(value: string) {
    return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function sameDisplayName(left: string, right: string) {
    return normalizeDisplayNameKey(left) === normalizeDisplayNameKey(right);
}

function isUserDisabled(user: UserRecord) {
    return Boolean(user.disabled) || user.status === "DISABLED" || user.status === "BANNED";
}

function ownedChannel(userId: string, id: string) {
    const channel = state.channels[channelKey(userId, id)];
    if (!channel) throw new HttpError(404, "渠道不存在或尚未保存 API Key");
    return channel;
}

function decryptChannelApiKey(channel: ChannelRecord) {
    try {
        return decryptSecret(channel.apiKey, encryptionSecret);
    } catch (currentError) {
        for (const previousSecret of previousEncryptionSecrets) {
            try {
                const plaintext = decryptSecret(channel.apiKey, previousSecret);
                channel.apiKey = encryptSecret(plaintext, encryptionSecret);
                queueStateWrite();
                return plaintext;
            } catch {
                // Continue through the configured previous keys.
            }
        }
        throw currentError;
    }
}

function ownedJob(userId: string, id: string) {
    const job = imageQueue.get(id);
    if (!job || job.input.userId !== userId) throw new HttpError(404, "任务不存在");
    return job;
}

function pruneTerminalJobs() {
    const now = Date.now();
    const jobsByUser = new Map<string, StoredImageJob[]>();
    for (const job of imageQueue.list()) {
        if (["queued", "running"].includes(job.status)) continue;
        const items = jobsByUser.get(job.input.userId) || [];
        items.push(job);
        jobsByUser.set(job.input.userId, items);
    }
    let changed = false;
    for (const jobs of jobsByUser.values()) {
        jobs.sort((left, right) => (right.finishedAt || right.createdAt) - (left.finishedAt || left.createdAt));
        for (const [index, job] of jobs.entries()) {
            const finishedAt = job.finishedAt || job.createdAt;
            if (index < MAX_TERMINAL_JOBS_PER_USER && now - finishedAt < JOB_RETENTION_MS) continue;
            if (!imageQueue.remove(job.id)) continue;
            delete state.jobs[job.id];
            cleanupJobFiles(job);
            changed = true;
        }
    }
    if (changed) queueStateWrite();
}

function cleanupJobFiles(job: StoredImageJob) {
    cleanupJobFilesFor(job.input.userId, job.id);
}

function cleanupJobFilesFor(userId: string, jobId: string) {
    const safeUserId = safeSegment(userId);
    const safeJobId = safeSegment(jobId);
    for (const root of [JOB_FILE_ROOT, join(DATA_DIR, "job-references")]) {
        try {
            rmSync(join(root, safeUserId, safeJobId), { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
        } catch (error) {
            console.warn(JSON.stringify({ event: "job_file_cleanup_failed", jobId, message: error instanceof Error ? error.message : "unknown error" }));
        }
    }
}

function activeUserJobs(userId: string) {
    return imageQueue.list().filter((job) => job.input.userId === userId && ["queued", "running"].includes(job.status)).length;
}

function ownedAsset(userId: string, key: string) {
    const asset = state.assets[assetKey(userId, key)];
    if (!asset) throw new HttpError(404, "素材不存在");
    return asset;
}

function assetKey(userId: string, key: string) {
    return `${userId}:${key}`;
}

function channelKey(userId: string, id: string) {
    return `${userId}:${id}`;
}

function queueStateWrite() {
    if (stateWriteQueued) return;
    stateWriteQueued = true;
    setTimeout(() => {
        stateWriteQueued = false;
        writeState();
    }, 100);
}

function writeState() {
    appDatabase.saveState(state);
}

function summarizeJobs() {
    return imageQueue.list().reduce<Record<string, number>>((summary, job) => ({ ...summary, [job.status]: (summary[job.status] || 0) + 1 }), {});
}

function logRequest(request: Request, response: Response, requestId: string, durationMs: number) {
    const url = new URL(request.url);
    console.info(JSON.stringify({ event: "http_request", requestId, method: request.method, path: url.pathname, status: response.status, durationMs }));
}

function normalizeDisplayName(value: unknown) {
    const displayName = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 32);
    if (displayName.length < 2) throw new HttpError(400, "昵称至少 2 个字符");
    if (/\p{C}/u.test(displayName)) throw new HttpError(400, "昵称不能包含控制字符");
    return displayName;
}

function normalizePersonalCode(value: unknown, minimumLength = 6) {
    const personalCode = String(value || "").trim();
    if (personalCode.length < minimumLength || personalCode.length > 128) throw new HttpError(400, `个人密码需为 ${minimumLength} 到 128 位`);
    return personalCode;
}

function optionalString(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
}

function normalizeImageQuality(value: unknown) {
    const quality = optionalString(value)?.toLowerCase();
    if (!quality || quality === "auto") return undefined;
    if (["low", "medium", "high", "standard", "hd"].includes(quality)) return quality;
    throw new HttpError(400, "生成质量参数无效");
}

function normalizeImageOutputFormat(value: unknown, model: string) {
    const format = optionalString(value)?.toLowerCase();
    if (!format || format === "auto") return undefined;
    if (!["png", "jpeg", "webp"].includes(format)) throw new HttpError(400, "输出格式参数无效");
    return model.toLowerCase().includes("gpt-image") ? format : undefined;
}

function imageOutputFormatMimeType(format?: string) {
    return ({ jpeg: "image/jpeg", webp: "image/webp", png: "image/png" } as Record<string, string>)[String(format || "").toLowerCase()] || "image/png";
}

function base64ImageDataUrl(base64: string, fallbackMimeType: string) {
    const sample = Buffer.from(base64.slice(0, 256), "base64");
    const mimeType = detectImageMimeFromBytes(sample) || fallbackMimeType;
    return `data:${mimeType};base64,${base64}`;
}

function normalizeJobSource(value: unknown): ImageJobInput["source"] {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "任务来源信息无效");
    const input = value as Record<string, unknown>;
    const route = optionalString(input.route);
    const projectId = optionalString(input.projectId);
    const nodeId = optionalString(input.nodeId);
    const label = optionalString(input.label);
    const fields = [route, projectId, nodeId, label];
    if (fields.some((item) => item && item.length > 180)) throw new HttpError(400, "任务来源信息过长");
    return { ...(route ? { route } : {}), ...(projectId ? { projectId } : {}), ...(nodeId ? { nodeId } : {}), ...(label ? { label } : {}) };
}

function isValidProjectPayload(value: unknown, id: string): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const project = value as Record<string, unknown>;
    if (project.id !== id || typeof project.title !== "string" || project.title.length > 160) return false;
    if (!Array.isArray(project.nodes) || !Array.isArray(project.connections) || project.nodes.length > 1_000 || project.connections.length > 4_000) return false;
    const nodeIds = new Set<string>();
    for (const node of project.nodes) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return false;
        const record = node as Record<string, unknown>;
        if (typeof record.id !== "string" || !record.id || record.id.length > 180 || nodeIds.has(record.id)) return false;
        nodeIds.add(record.id);
    }
    for (const connection of project.connections) {
        if (!connection || typeof connection !== "object" || Array.isArray(connection)) return false;
        const record = connection as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.fromNodeId !== "string" || typeof record.toNodeId !== "string" || !nodeIds.has(record.fromNodeId) || !nodeIds.has(record.toNodeId)) return false;
    }
    return true;
}

function normalizeAssetPrefix(value: FormDataEntryValue | null) {
    const prefix = String(value || "file").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new HttpError(400, "素材类型无效");
    return prefix;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSafeDataImage(value: string) {
    try {
        decodeImageDataUrl(value);
    } catch (error) {
        const message = error instanceof Error ? error.message : "参考图格式无效";
        throw new HttpError(message.includes("超过") ? 413 : 400, message);
    }
}

function parseDataUrl(value: string) {
    try {
        const parsed = decodeImageDataUrl(value, MAX_UPSTREAM_IMAGE_BYTES);
        return { mimeType: parsed.mimeType, base64: parsed.base64 };
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "图片数据格式无效");
    }
}

function dataUrlBlob(value: string) {
    const parsed = parseDataUrl(value);
    return new Blob([Buffer.from(parsed.base64, "base64")], { type: parsed.mimeType });
}

function normalizeAspectRatio(value: string) {
    const dimensions = value.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return value;
    return `${dimensions[1]}:${dimensions[2]}`;
}

function imageExtension(mimeType: string) {
    return ({ "image/jpeg": ".jpg", "image/webp": ".webp", "image/avif": ".avif", "image/gif": ".gif" } as Record<string, string>)[mimeType] || ".png";
}

function safeSegment(value: string) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function sanitizeId(value: string | undefined) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

function contentType(path: string) {
    return ({ ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] || "application/octet-stream";
}

function positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

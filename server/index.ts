import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { isIP } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

import { createIdentityToken, createSessionToken, expiredIdentityCookie, expiredSessionCookie, hashAccessCode, identityCookie, readCookie, readIdentityToken, readSessionToken, sessionCookie, verifyAccessCode, type SessionPayload } from "./lib/auth";
import { AssetLibraryInputError, normalizeAssetLibrary, normalizeAssetLibraryItem } from "./lib/asset-library";
import { AsyncSemaphore } from "./lib/async-semaphore";
import { canAccessUserAvatar } from "./lib/avatar-access";
import { decryptSecret, encryptSecret, normalizeEncryptionSecret } from "./lib/crypto-store";
import { generationHistoryJobIdsForDeletion, GenerationHistoryInputError, normalizeGenerationHistory, normalizeGenerationHistoryDeletion, normalizeGenerationHistoryItem } from "./lib/generation-history";
import { parseSingleByteRange } from "./lib/http-range";
import { decodeImageDataUrl, detectImageMimeFromBytes, isAllowedImageMimeType, readImageDimensions, resolveImageMimeType } from "./lib/image-mime";
import { buildOpenAiImageRequestOptions, imageResponseItems, resolveOpenAiImageSize, usesJsonReferenceGeneration } from "./lib/image-request";
import { JobQueue, type QueueJob } from "./lib/job-queue";
import { isAllowedMediaMimeType, resolveMediaMimeType } from "./lib/media-mime";
import { createMediaTaskStore, type MediaTaskKind } from "./lib/media-task-store";
import { listPlatformChannels, normalizeChannelModels, platformChannelKey, platformChannelModels, resolvePlatformChannel } from "./lib/platform-channels";
import { isValidProjectPayload } from "./lib/project-payload";
import { buildSadaiImageRequestOptions, isSadaiImage2Channel } from "./lib/sadai-image";
import { createSqliteBackupManager } from "./lib/sqlite-backup";
import { buildUuAsyncImageRequest, isUuAsyncGptImage2Channel, isUuImageAsyncChannel, readUuAsyncTask } from "./lib/uu-image-async";
import { readUpstreamErrorMessage, readUpstreamNonJsonError } from "./lib/upstream-error";
import { assetCacheControl, assetStorageFilename, legacyAssetStorageFilename, nextAssetVersion } from "./lib/storage-path";
import { assertAllowedUpstreamUrl, assertResolvedPublicUpstreamUrl, buildUpstreamUrl, isLoopbackSetupRequest, isSameApplicationOrigin, normalizePublicBaseUrl, resolveAllowedRedirect, type ProviderProtocol } from "./lib/url-policy";
import { proxyPathModel, proxyRequestKind } from "./lib/ai-proxy-policy";
import { openAppDatabase, persistReference } from "./db/database";
import { createCultivationService, CultivationError, type CultivationCapabilityUpdate, type CultivationRealmUpdate, type CultivationStageUpdate, type CultivationUserUpdate } from "./modules/cultivation/service";
import type { ChannelRecord, GenerationHistoryKind, ImageJobImage, ImageJobInput, ImageJobOutput, StoredAsset, StoredImageJob, StoredImageReference, UserRecord } from "./types";

const PORT = positiveInt(process.env.PORT, 3000);
const DATA_DIR = resolve(process.env.DATA_DIR || "/data");
const WEB_ROOT = resolve(process.env.WEB_ROOT || "/app/web");
const JOB_FILE_ROOT = join(DATA_DIR, "job-files");
const ASSET_ROOT = join(DATA_DIR, "assets");
const PROMPT_CACHE_ROOT = join(DATA_DIR, "prompt-cache");
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_JOB_JSON_BYTES = 32 * 1024 * 1024;
const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const MAX_IMAGE_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_AUDIO_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_BYTES = MAX_VIDEO_ASSET_BYTES;
const MAX_ASSET_UPLOAD_BYTES = MAX_ASSET_BYTES + 512 * 1024;
const AVATAR_ASSET_KEY = "image:avatar";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_UPLOAD_BYTES = MAX_AVATAR_BYTES + 256 * 1024;
const MAX_USER_ASSET_BYTES = Math.max(MAX_ASSET_BYTES, positiveInt(process.env.MAX_USER_ASSET_BYTES, 2 * 1024 * 1024 * 1024));
const MAX_UPSTREAM_JSON_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_USER_JOB_FILE_BYTES = Math.max(MAX_UPSTREAM_IMAGE_BYTES, positiveInt(process.env.MAX_USER_JOB_FILE_BYTES, 2 * 1024 * 1024 * 1024));
const MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES = Math.max(MAX_UPSTREAM_JSON_BYTES, Math.min(48 * 1024 * 1024, positiveInt(process.env.MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES, 48 * 1024 * 1024)));
const MAX_PROMPT_PROXY_BYTES = 20 * 1024 * 1024;
const MAX_PROXY_BODY_BYTES = 33 * 1024 * 1024;
const MAX_PROMPT_CHARS = Math.max(1_000, positiveInt(process.env.MAX_PROMPT_CHARS, 20_000));
const MAX_PROJECTS_PER_USER = Math.max(10, positiveInt(process.env.MAX_PROJECTS_PER_USER, 100));
const MAX_PROJECT_BYTES_PER_USER = Math.max(8 * 1024 * 1024, positiveInt(process.env.MAX_PROJECT_BYTES_PER_USER, 128 * 1024 * 1024));
const MIN_FREE_DISK_BYTES = Math.max(64 * 1024 * 1024, positiveInt(process.env.MIN_FREE_DISK_BYTES, 512 * 1024 * 1024));
const MAX_PROMPT_CACHE_ENTRIES = Math.max(50, positiveInt(process.env.MAX_PROMPT_CACHE_ENTRIES, 500));
const MAX_PROMPT_CACHE_BYTES = Math.max(MAX_PROMPT_PROXY_BYTES, positiveInt(process.env.MAX_PROMPT_CACHE_BYTES, 256 * 1024 * 1024));
const JOB_RETENTION_MS = Math.max(60 * 60_000, positiveInt(process.env.JOB_RETENTION_MS, 30 * 24 * 60 * 60_000));
const MAX_TERMINAL_JOBS_PER_USER = Math.max(20, positiveInt(process.env.MAX_TERMINAL_JOBS_PER_USER, 200));
const MEDIA_TASK_RETENTION_MS = Math.max(24 * 60 * 60_000, positiveInt(process.env.MEDIA_TASK_RETENTION_MS, 30 * 24 * 60 * 60_000));
const MEDIA_TASK_ACTIVE_TTL_MS = Math.max(10 * 60_000, positiveInt(process.env.MEDIA_TASK_ACTIVE_TTL_MS, 2 * 60 * 60_000));
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
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
const secureCookies = PUBLIC_BASE_URL.startsWith("https://") || process.env.FORCE_SECURE_COOKIES === "1";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ALLOW_NEW_USERS = process.env.ALLOW_NEW_USERS !== "0";
const MAX_REGISTERED_USERS = Math.max(2, Math.min(10_000, positiveInt(process.env.MAX_REGISTERED_USERS, 20)));
const RATE_BUCKET_LIMIT = Math.max(100, positiveInt(process.env.RATE_BUCKET_LIMIT, 10_000));
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== "0";
const BACKUP_DIR = resolve(process.env.BACKUP_DIR || join(DATA_DIR, "backups"));
const BACKUP_INTERVAL_HOURS = Math.max(1, positiveInt(process.env.BACKUP_INTERVAL_HOURS, 24));
const BACKUP_RETENTION_COUNT = Math.max(2, positiveInt(process.env.BACKUP_RETENTION_COUNT, 14));
const SHUTDOWN_GRACE_MS = Math.max(5_000, Math.min(60_000, positiveInt(process.env.SHUTDOWN_GRACE_MS, 20_000)));
const HEAVY_REQUEST_CONCURRENCY = Math.max(1, Math.min(8, positiveInt(process.env.HEAVY_REQUEST_CONCURRENCY, 4)));
const APP_VERSION = readAppVersion();
const APP_COMMIT = (process.env.APP_COMMIT || "unknown").trim();

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JOB_FILE_ROOT, { recursive: true });
mkdirSync(ASSET_ROOT, { recursive: true });
mkdirSync(PROMPT_CACHE_ROOT, { recursive: true });
prunePromptCache();

const appDatabase = openAppDatabase({ dataDir: DATA_DIR });
let state = appDatabase.loadState();
const assetBytesByUser = new Map<string, number>();
for (const asset of Object.values(state.assets)) assetBytesByUser.set(asset.userId, (assetBytesByUser.get(asset.userId) || 0) + asset.bytes);
const jobFileBytesByUser = new Map<string, number>();
const jobFileBytesByJob = new Map<string, number>();
for (const job of Object.values(state.jobs)) {
    const bytes = (job.result?.images || []).reduce((total, image) => total + Math.max(0, Number(image.bytes) || 0), 0);
    if (bytes) {
        jobFileBytesByJob.set(job.id, bytes);
        jobFileBytesByUser.set(job.input.userId, (jobFileBytesByUser.get(job.input.userId) || 0) + bytes);
    } else if (["failed", "canceled"].includes(job.status)) {
        cleanupJobOutputFilesFor(job.input.userId, job.id);
    }
}
const cultivation = appDatabase.raw ? createCultivationService(appDatabase.raw) : null;
const mediaTasks = appDatabase.raw ? createMediaTaskStore(appDatabase.raw, MEDIA_TASK_RETENTION_MS, MEDIA_TASK_ACTIVE_TTL_MS) : null;
mediaTasks?.prune();
const backupManager = appDatabase.raw
    ? createSqliteBackupManager({
          database: appDatabase.raw,
          directory: BACKUP_DIR,
          enabled: BACKUP_ENABLED,
          intervalMs: BACKUP_INTERVAL_HOURS * 60 * 60_000,
          retentionCount: BACKUP_RETENTION_COUNT,
      })
    : null;
for (const user of Object.values(state.users)) cultivation?.ensureUser(user.userId, Boolean(user.admin));
const configuredEncryptionSecret = normalizeEncryptionSecret(process.env.APP_ENCRYPTION_KEY, PUBLIC_BASE_URL.startsWith("https://"));
const encryptionSecret = configuredEncryptionSecret || state.auth.sessionSecret;
const previousEncryptionSecrets = [
    ...(process.env.APP_ENCRYPTION_KEY_PREVIOUS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ...(configuredEncryptionSecret ? [state.auth.sessionSecret] : []),
].filter((value, index, values) => value !== encryptionSecret && values.indexOf(value) === index);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const activeMediaProxyRequests = new Map<string, number>();
const activeMediaProxyUsageIds = new Set<string>();
const requestClientIps = new WeakMap<Request, string>();
const requestPeerIps = new WeakMap<Request, string>();
let stateWriteQueued = false;
let nextRateBucketSweepAt = 0;
let authMutation = Promise.resolve();
let assetMutation = Promise.resolve();
let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
const geminiImageSemaphore = new AsyncSemaphore(GEMINI_IMAGE_CONCURRENCY);
const promptProxySemaphore = new AsyncSemaphore(PROMPT_PROXY_CONCURRENCY);
const heavyRequestSemaphore = new AsyncSemaphore(HEAVY_REQUEST_CONCURRENCY);

const imageQueue = new JobQueue<ImageJobInput, ImageJobOutput>({
    concurrency: JOB_CONCURRENCY,
    worker: runImageJob,
    onChange: (job) => {
        state.jobs[job.id] = job;
        appDatabase.saveJob(job);
        if (["succeeded", "failed", "canceled"].includes(job.status)) pruneTerminalJobs();
    },
    onInitializationFailure: (job) => {
        cultivation?.refundGeneration(job.id, "initial job persistence failed");
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
            cleanupJobOutputFilesFor(job.input.userId, job.id);
        }
    }
    imageQueue.restore(job);
}
cultivation?.reconcileReservations(
    Object.values(state.jobs)
        .filter((job) => ["queued", "running"].includes(job.status))
        .map((job) => job.id),
);
pruneTerminalJobs();
writeState();
backupManager?.start();

let server: ReturnType<typeof Bun.serve>;
server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    idleTimeout: 255,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    async fetch(request) {
        const remoteAddress = server.requestIP(request)?.address || "unknown";
        requestPeerIps.set(request, remoteAddress);
        requestClientIps.set(request, resolveClientIp(request, remoteAddress));
        const startedAt = Date.now();
        const requestId = randomUUID();
        let response: Response;
        try {
            response = await route(request, requestId);
        } catch (error) {
            response = errorResponse(error, requestId);
        }
        const secured = withSecurityHeaders(response, requestId, request);
        logRequest(request, secured, requestId, Date.now() - startedAt);
        return secured;
    },
});

console.info(
    JSON.stringify({
        event: "server_started",
        port: server.port,
        dataDir: DATA_DIR,
        webRoot: WEB_ROOT,
        jobConcurrency: JOB_CONCURRENCY,
        version: APP_VERSION,
        commit: APP_COMMIT,
    }),
);

async function route(request: Request, requestId: string) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return healthResponse();
    if (shuttingDown) throw new HttpError(503, "服务正在平滑重启，请稍后重试");
    if (url.pathname === "/config.js") return runtimeConfigResponse();
    if (url.pathname.startsWith("/prompt-proxy/")) {
        const session = requireSession(request);
        enforceRateLimit(`${session.userId}:${clientIp(request)}:prompt`, 180);
        return proxyPromptAsset(request, url, requestId);
    }
    if (url.pathname === "/api/auth/status") return authStatus(request);
    if (url.pathname === "/api/auth/setup" && request.method === "POST") {
        enforceSameOrigin(request);
        if (!isLoopbackSetupRequest(request.url, requestPeerIps.get(request) || "unknown")) throw new HttpError(403, "管理员初始化只能通过服务器回环地址完成");
        return setupAuth(request);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
        enforceSameOrigin(request);
        return login(request);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        enforceSameOrigin(request);
        return logout();
    }
    if (url.pathname.startsWith("/api/")) {
        enforceSameOrigin(request);
        const session = requireSession(request);
        enforceRateLimit(`${session.userId}:${clientIp(request)}`, request.method === "GET" ? 240 : 90);
        if (url.pathname === "/api/admin/metrics" && request.method === "GET") return adminMetrics(session);
        if (url.pathname === "/api/admin/channels/metrics" && request.method === "GET") return adminChannelMetrics(url, session);
        if (url.pathname === "/api/admin/users" && request.method === "GET") return listUsers(session);
        const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userMatch && request.method === "PUT") return updateUserAccess(request, session, decodeRouteSegment(userMatch[1], "用户 ID"));
        if (url.pathname === "/api/cultivation/me" && request.method === "GET") return cultivationProfile(session);
        const profileAvatarMatch = url.pathname.match(/^\/api\/profile\/avatar\/([^/]+)$/);
        if (profileAvatarMatch && ["GET", "HEAD"].includes(request.method)) return serveProfileAvatar(request, session, decodeRouteSegment(profileAvatarMatch[1], "用户 ID"));
        if (url.pathname === "/api/profile/avatar" && request.method === "POST") return heavyRequestSemaphore.run(request.signal, () => uploadProfileAvatar(request, session));
        if (url.pathname === "/api/profile/avatar" && request.method === "DELETE") return deleteProfileAvatar(session);
        const seenBreakthroughMatch = url.pathname.match(/^\/api\/cultivation\/breakthroughs\/([^/]+)\/seen$/);
        if (seenBreakthroughMatch && request.method === "POST") return markCultivationBreakthroughSeen(session, seenBreakthroughMatch[1]);
        if (url.pathname === "/api/admin/cultivation/users" && request.method === "GET") return adminCultivationUsers(url, session);
        const cultivationUserMatch = url.pathname.match(/^\/api\/admin\/cultivation\/users\/([^/]+)$/);
        if (cultivationUserMatch && request.method === "PATCH") return adminUpdateCultivationUser(request, session, cultivationUserMatch[1]);
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
        if (channelMatch && request.method === "PUT") return saveChannel(request, session, decodeRouteSegment(channelMatch[1], "渠道 ID"));
        if (channelMatch && request.method === "DELETE") return deleteChannel(session, decodeRouteSegment(channelMatch[1], "渠道 ID"));
        if (url.pathname === "/api/library-assets" && request.method === "GET") return listLibraryAssets(session);
        if (url.pathname === "/api/library-assets" && request.method === "PUT") return heavyRequestSemaphore.run(request.signal, () => replaceLibraryAssets(request, session));
        const libraryAssetMatch = url.pathname.match(/^\/api\/library-assets\/([^/]+)$/);
        if (libraryAssetMatch && request.method === "PUT") return saveLibraryAsset(request, session, decodeRouteSegment(libraryAssetMatch[1], "资产记录 ID"));
        if (libraryAssetMatch && request.method === "DELETE") return deleteLibraryAsset(session, decodeRouteSegment(libraryAssetMatch[1], "资产记录 ID"));
        const generationHistoryMatch = url.pathname.match(/^\/api\/generation-history\/(image|video)$/);
        if (generationHistoryMatch && request.method === "GET") return listGenerationHistory(session, generationHistoryMatch[1] as GenerationHistoryKind);
        if (generationHistoryMatch && request.method === "PUT")
            return heavyRequestSemaphore.run(request.signal, () => mergeGenerationHistory(request, session, generationHistoryMatch[1] as GenerationHistoryKind));
        if (generationHistoryMatch && request.method === "DELETE") return deleteGenerationHistoryItems(request, session, generationHistoryMatch[1] as GenerationHistoryKind);
        const generationHistoryItemMatch = url.pathname.match(/^\/api\/generation-history\/(image|video)\/([^/]+)$/);
        if (generationHistoryItemMatch && request.method === "PUT")
            return saveGenerationHistoryItem(request, session, generationHistoryItemMatch[1] as GenerationHistoryKind, decodeRouteSegment(generationHistoryItemMatch[2], "生成记录 ID"));
        if (generationHistoryItemMatch && request.method === "DELETE")
            return deleteGenerationHistoryItem(session, generationHistoryItemMatch[1] as GenerationHistoryKind, decodeRouteSegment(generationHistoryItemMatch[2], "生成记录 ID"));
        if (url.pathname === "/api/assets/from-job" && request.method === "POST") return heavyRequestSemaphore.run(request.signal, () => promoteJobAsset(request, session));
        if (url.pathname === "/api/assets" && request.method === "POST") return heavyRequestSemaphore.run(request.signal, () => uploadAsset(request, session));
        const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
        if (assetMatch && ["GET", "HEAD"].includes(request.method)) return serveAsset(request, session, decodeRouteSegment(assetMatch[1], "素材 ID"));
        if (assetMatch && request.method === "DELETE") return deleteAsset(session, decodeRouteSegment(assetMatch[1], "素材 ID"));
        if (url.pathname === "/api/jobs/images" && request.method === "POST") return heavyRequestSemaphore.run(request.signal, () => createImageJob(request, session));
        if (url.pathname === "/api/jobs" && request.method === "GET") return listJobs(session);
        const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
        if (retryMatch && request.method === "POST") return retryJob(request, session, retryMatch[1]);
        const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch && request.method === "GET") return getJob(session, jobMatch[1]);
        if (jobMatch && request.method === "DELETE") return deleteJob(url, session, jobMatch[1]);
        const jobFileMatch = url.pathname.match(/^\/api\/job-files\/([^/]+)\/([^/]+)$/);
        if (jobFileMatch && ["GET", "HEAD"].includes(request.method)) return serveJobFile(request, session, jobFileMatch[1], jobFileMatch[2]);
        if (url.pathname === "/api/projects" && request.method === "GET")
            return json({
                items: Object.values(state.projects[session.userId] || {}),
                deleted: Object.entries(state.projectTombstones[session.userId] || {}).map(([projectId, tombstone]) => ({ projectId, ...tombstone })),
            });
        const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (projectMatch && request.method === "PUT") return heavyRequestSemaphore.run(request.signal, () => saveProject(request, session, decodeRouteSegment(projectMatch[1], "项目 ID")));
        if (projectMatch && request.method === "DELETE") return deleteProject(url, session, decodeRouteSegment(projectMatch[1], "项目 ID"));
        const proxyMatch = url.pathname.match(/^\/api\/ai\/([^/]+)\/(openai|gemini)\/(.*)$/);
        if (proxyMatch) return proxyAiRequest(request, session, decodeRouteSegment(proxyMatch[1], "渠道 ID"), proxyMatch[2] as ProviderProtocol, `/${proxyMatch[3]}`, requestId);
        return json({ error: { message: "接口不存在" }, requestId }, 404);
    }
    return serveStatic(url.pathname, request.method);
}

async function authStatus(request: Request) {
    const candidate = optionalSession(request);
    const user = candidate ? state.users[candidate.userId] : undefined;
    const session = candidate && user && !isUserDisabled(user) ? candidate : null;
    return json({
        configured: Boolean(state.auth.accessCodeHash),
        authenticated: Boolean(session),
        user: session && user ? publicAuthUser(user) : null,
        publicMode: true,
    });
}

async function setupAuth(request: Request) {
    enforceRateLimit(`setup:${clientIp(request)}`, 10);
    const body = await readJson<{
        accessCode?: string;
        displayName?: string;
        personalCode?: string;
    }>(request);
    const accessCode = String(body.accessCode || "").trim();
    const displayName = normalizeDisplayName(body.displayName);
    const personalCode = normalizePersonalCode(body.personalCode, 10);
    if (accessCode.length < 8) return json({ error: { message: "访问口令至少 8 位" } }, 400);
    return withAuthMutation(async () => {
        if (state.auth.accessCodeHash) return json({ error: { message: "访问口令已经设置" } }, 409);
        const userId = randomUUID();
        state.auth.accessCodeHash = await hashAccessCode(accessCode);
        state.auth.adminUserId = userId;
        state.users[userId] = {
            userId,
            displayName,
            admin: true,
            status: "NORMAL",
            createdAt: Date.now(),
            loginHash: await hashAccessCode(personalCode),
        };
        writeState();
        cultivation?.ensureUser(userId, true);
        cultivation?.recordLogin({
            userId,
            displayName,
            result: "setup-success",
            ip: clientIp(request),
            userAgent: request.headers.get("user-agent") || "",
            secret: state.auth.sessionSecret,
        });
        return authenticatedResponse(state.users[userId]);
    });
}

async function login(request: Request) {
    enforceRateLimit(`login:${clientIp(request)}`, 20);
    const body = await readJson<{
        accessCode?: string;
        displayName?: string;
        personalCode?: string;
    }>(request);
    const rawDisplayName = String(body.displayName || "").trim();
    const displayName = normalizeDisplayName(rawDisplayName);
    const personalCode = normalizePersonalCode(body.personalCode);
    return withAuthMutation(async () => {
        if (!state.auth.accessCodeHash) return json({ error: { message: "站点尚未初始化" } }, 409);
        if (!(await verifyAccessCode(String(body.accessCode || "").trim(), state.auth.accessCodeHash))) {
            cultivation?.recordLogin({
                displayName: rawDisplayName || "unknown",
                result: "invalid-access-code",
                ip: clientIp(request),
                userAgent: request.headers.get("user-agent") || "",
                secret: state.auth.sessionSecret,
            });
            return json({ error: { message: "访问口令错误" } }, 401);
        }
        const identityUserId = readIdentityToken(readCookie(request, "canvas_identity"), state.auth.sessionSecret);
        const existing = Object.values(state.users).find((user) => sameDisplayName(user.displayName, displayName));
        if (existing && isUserDisabled(existing)) {
            cultivation?.recordLogin({
                userId: existing.userId,
                displayName,
                result: "disabled",
                ip: clientIp(request),
                userAgent: request.headers.get("user-agent") || "",
                secret: state.auth.sessionSecret,
            });
            return json({ error: { message: "当前账号已停用" } }, 403);
        }
        if (existing?.loginHash && !(await verifyAccessCode(personalCode, existing.loginHash))) {
            cultivation?.recordLogin({
                userId: existing.userId,
                displayName,
                result: "invalid-personal-code",
                ip: clientIp(request),
                userAgent: request.headers.get("user-agent") || "",
                secret: state.auth.sessionSecret,
            });
            return json({ error: { message: "个人密码错误" } }, 401);
        }
        if (existing && !existing.loginHash && existing.userId !== identityUserId)
            return json(
                {
                    error: {
                        message: "该旧账号尚未设置个人密码，请先在原设备登录后完成升级",
                    },
                },
                409,
            );
        if (!existing && !ALLOW_NEW_USERS) return json({ error: { message: "新用户注册已关闭，请联系管理员开通账号" } }, 403);
        if (!existing && Object.keys(state.users).length >= MAX_REGISTERED_USERS)
            return json({ error: { message: `站点成员已达到上限（${MAX_REGISTERED_USERS} 人），请联系管理员` } }, 403);
        const user = existing || {
            userId: randomUUID(),
            displayName,
            admin: false,
            status: "NORMAL" as const,
            createdAt: Date.now(),
            loginHash: await hashAccessCode(personalCode),
        };
        if (!user.loginHash) user.loginHash = await hashAccessCode(personalCode);
        user.disabled = false;
        user.status = "NORMAL";
        state.users[user.userId] = user;
        writeState();
        cultivation?.ensureUser(user.userId, Boolean(user.admin));
        cultivation?.recordLogin({
            userId: user.userId,
            displayName: user.displayName,
            result: "success",
            ip: clientIp(request),
            userAgent: request.headers.get("user-agent") || "",
            secret: state.auth.sessionSecret,
        });
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
    return {
        userId: user.userId,
        displayName: user.displayName,
        admin: Boolean(user.admin),
        avatarUrl: avatarUrlFor(user.userId),
    };
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
    const expectedUserId = request.headers.get("x-expected-user-id")?.trim();
    if (expectedUserId && expectedUserId !== session.userId) throw new HttpError(409, "账号已经切换，本次后台同步已取消");
    return session;
}

function listUsers(session: SessionPayload) {
    requireAdmin(session);
    return json({
        items: Object.values(state.users).map(({ userId, displayName, admin, createdAt, disabled }) => ({
            userId,
            displayName,
            admin: Boolean(admin),
            createdAt,
            disabled: Boolean(disabled),
        })),
    });
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
    return json({
        user: {
            userId: user.userId,
            displayName: user.displayName,
            admin: Boolean(user.admin),
            createdAt: user.createdAt,
            disabled: Boolean(user.disabled),
        },
    });
}

function adminMetrics(session: SessionPayload) {
    requireAdmin(session);
    return json({
        users: Object.keys(state.users).length,
        channels: listPlatformChannels(state).length,
        jobs: summarizeJobs(),
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        backup: backupManager?.status() || null,
    });
}

function adminChannelMetrics(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const days = Math.max(1, Math.min(30, Math.floor(Number(url.searchParams.get("days")) || 7)));
    const usage = requireCultivation().listChannelMetrics(days);
    const usageByChannel = new Map<string, (typeof usage)[number]>();
    for (const metric of usage) {
        const current = usageByChannel.get(metric.channelId);
        if (!current) {
            usageByChannel.set(metric.channelId, { ...metric });
            continue;
        }
        const durationTotal = current.avgDurationMs * current.settledJobs + metric.avgDurationMs * metric.settledJobs;
        current.totalJobs += metric.totalJobs;
        current.settledJobs += metric.settledJobs;
        current.refundedJobs += metric.refundedJobs;
        current.activeJobs += metric.activeJobs;
        current.requestedImages += metric.requestedImages;
        current.successImages += metric.successImages;
        current.failedImages += metric.failedImages;
        current.avgDurationMs = current.settledJobs ? Math.round(durationTotal / current.settledJobs) : 0;
        current.lastUsedAt = Math.max(current.lastUsedAt, metric.lastUsedAt);
    }
    const cutoff = Date.now() - days * 24 * 60 * 60_000;
    const recentErrors = new Map<string, string>();
    for (const job of Object.values(state.jobs).sort((left, right) => right.createdAt - left.createdAt)) {
        if (job.createdAt < cutoff || job.status !== "failed" || !job.error) continue;
        const key = job.input.channelId;
        if (!recentErrors.has(key)) recentErrors.set(key, job.error.slice(0, 300));
    }
    const items = listPlatformChannels(state)
        .map((channel) => {
            const key = channel.id;
            const metric = usageByChannel.get(key);
            const completedImages = (metric?.successImages || 0) + (metric?.failedImages || 0);
            const successRate = completedImages ? Math.round(((metric?.successImages || 0) / completedImages) * 100) : null;
            const status = (metric?.activeJobs || 0) > 0 ? "active" : successRate === null ? "idle" : successRate >= 90 ? "healthy" : successRate >= 60 ? "degraded" : "unavailable";
            let host = channel.baseUrl;
            try {
                host = new URL(channel.baseUrl).host;
            } catch {
                host = "地址无效";
            }
            return {
                userId: channel.userId,
                ownerName: state.users[channel.userId]?.displayName || channel.userId,
                channelId: channel.id,
                channelName: channel.name,
                host,
                protocol: channel.apiFormat,
                status,
                successRate,
                totalJobs: metric?.totalJobs || 0,
                activeJobs: metric?.activeJobs || 0,
                requestedImages: metric?.requestedImages || 0,
                successImages: metric?.successImages || 0,
                failedImages: metric?.failedImages || 0,
                avgDurationMs: metric?.avgDurationMs || 0,
                lastUsedAt: metric?.lastUsedAt || 0,
                lastError: recentErrors.get(key) || "",
            };
        })
        .sort((left, right) => Number(right.activeJobs > 0) - Number(left.activeJobs > 0) || right.lastUsedAt - left.lastUsedAt || left.channelName.localeCompare(right.channelName));
    return json({ days, items });
}

function requireAdmin(session: SessionPayload) {
    if (!state.users[session.userId]?.admin) throw new HttpError(403, "仅管理员可以执行此操作");
}

function cultivationProfile(session: SessionPayload) {
    const service = requireCultivation();
    service.ensureUser(session.userId, Boolean(state.users[session.userId]?.admin));
    const { internalNote: _internalNote, ...profile } = service.getProfile(session.userId);
    return json({
        profile: { ...profile, avatarUrl: avatarUrlFor(session.userId) },
    });
}

function markCultivationBreakthroughSeen(session: SessionPayload, breakthroughId: string) {
    requireCultivation().markBreakthroughSeen(session.userId, breakthroughId);
    return new Response(null, { status: 204 });
}

function adminCultivationUsers(url: URL, session: SessionPayload) {
    requireAdmin(session);
    const { page, pageSize } = readPagination(url);
    const result = requireCultivation().listUsers(page, pageSize, url.searchParams.get("search") || "");
    return json({
        ...result,
        items: result.items.map((item) => ({
            ...item,
            avatarUrl: avatarUrlFor(item.userId),
        })),
    });
}

async function adminUpdateCultivationUser(request: Request, session: SessionPayload, encodedUserId: string) {
    requireAdmin(session);
    const userId = decodeRouteSegment(encodedUserId, "用户 ID");
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

function adminCultivationConfiguration(session: SessionPayload) {
    requireAdmin(session);
    return json(requireCultivation().getConfiguration());
}

async function adminUpdateRealm(request: Request, session: SessionPayload, encodedRealmId: string) {
    requireAdmin(session);
    const body = await readJson<CultivationRealmUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateRealm(session.userId, decodeRouteSegment(encodedRealmId, "境界 ID"), input, String(reason || "")));
}

async function adminUpdateStage(request: Request, session: SessionPayload, encodedStageId: string) {
    requireAdmin(session);
    const body = await readJson<CultivationStageUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateStage(session.userId, decodeRouteSegment(encodedStageId, "阶段 ID"), input, String(reason || "")));
}

async function adminUpdateCapability(request: Request, session: SessionPayload, encodedCapabilityKey: string) {
    requireAdmin(session);
    const body = await readJson<CultivationCapabilityUpdate & { reason?: string }>(request);
    const { reason, ...input } = body;
    return json(requireCultivation().updateCapability(session.userId, decodeRouteSegment(encodedCapabilityKey, "能力 ID"), input, String(reason || "")));
}

async function adminUpdateRewards(request: Request, session: SessionPayload) {
    requireAdmin(session);
    const body = await readJson<{
        rewards?: Record<string, number>;
        reason?: string;
    }>(request);
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
    return {
        page: Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1)),
        pageSize: Math.max(1, Math.min(50, Math.floor(Number(url.searchParams.get("pageSize")) || 20))),
    };
}

function listChannels(session: SessionPayload) {
    void session;
    return json({
        items: listPlatformChannels(state).map(({ apiKey: _apiKey, userId: _userId, ...channel }) => ({
            ...channel,
            hasApiKey: true,
        })),
    });
}

async function saveChannel(request: Request, session: SessionPayload, id: string) {
    requireAdmin(session);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || ["__proto__", "prototype", "constructor"].includes(id.toLowerCase())) throw new HttpError(400, "渠道 ID 无效");
    const body = await readJson<{
        name?: string;
        baseUrl?: string;
        apiFormat?: ProviderProtocol;
        apiKey?: string;
        models?: unknown;
    }>(request);
    const baseUrl = String(body.baseUrl || "").trim();
    try {
        const parsed = assertAllowedUpstreamUrl(baseUrl);
        if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("渠道地址不能包含账号、密码、查询参数或片段");
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "渠道地址无效");
    }
    const apiFormat: ProviderProtocol = body.apiFormat === "gemini" ? "gemini" : "openai";
    const adminUserId = state.auth.adminUserId;
    if (!adminUserId) throw new HttpError(409, "Platform administrator is not configured");
    const key = platformChannelKey(adminUserId, id);
    const existing = state.channels[key];
    const plaintext = String(body.apiKey || "").trim();
    if (!plaintext && !existing) throw new HttpError(400, "首次保存渠道时必须填写 API Key");
    state.channels[key] = {
        id,
        userId: adminUserId,
        name: normalizeShortText(body.name || existing?.name || "未命名渠道", 80, "渠道名称"),
        baseUrl,
        apiFormat,
        apiKey: plaintext ? encryptSecret(plaintext, encryptionSecret) : existing.apiKey,
        models: body.models === undefined ? existing?.models || [] : normalizeChannelModels(body.models),
        updatedAt: Date.now(),
    };
    writeState();
    const { apiKey: _apiKey, userId: _userId, ...channel } = state.channels[key];
    return json({ ok: true, channel: { ...channel, hasApiKey: true } });
}

function deleteChannel(session: SessionPayload, id: string) {
    requireAdmin(session);
    const adminUserId = state.auth.adminUserId;
    if (adminUserId) delete state.channels[platformChannelKey(adminUserId, id)];
    writeState();
    return new Response(null, { status: 204 });
}

function listLibraryAssets(session: SessionPayload) {
    const library = appDatabase.loadAssetLibrary(session.userId);
    return json({
        initialized: library.initialized,
        items: library.items.map((item) => item.payload),
    });
}

async function replaceLibraryAssets(request: Request, session: SessionPayload) {
    const body = await readJson<{ items?: unknown; initializeOnly?: boolean }>(request);
    if (body.initializeOnly) {
        const current = appDatabase.loadAssetLibrary(session.userId);
        if (current.initialized)
            return json({
                initialized: true,
                items: current.items.map((item) => item.payload),
            });
    }
    const items = normalizeAssetLibrary(body.items, (storageKey) => state.assets[assetKey(session.userId, storageKey)]);
    appDatabase.replaceAssetLibrary(session.userId, items);
    return json({ initialized: true, items: items.map((item) => item.payload) });
}

async function saveLibraryAsset(request: Request, session: SessionPayload, id: string) {
    const body = await readJson<{ item?: unknown }>(request);
    const item = normalizeAssetLibraryItem(body.item, id, (storageKey) => state.assets[assetKey(session.userId, storageKey)]);
    appDatabase.upsertAssetLibraryItem(session.userId, item);
    return json({ item: item.payload });
}

function deleteLibraryAsset(session: SessionPayload, id: string) {
    appDatabase.deleteAssetLibraryItem(session.userId, id);
    return new Response(null, { status: 204 });
}

function listGenerationHistory(session: SessionPayload, kind: GenerationHistoryKind) {
    const tombstones = appDatabase.loadGenerationHistoryTombstones(session.userId, kind).map((item) => ({
        id: item.id,
        createdAt: item.deletedAt,
        updatedAt: item.deletedAt,
        deletedAt: item.deletedAt,
    }));
    return json({
        items: [...appDatabase.loadGenerationHistory(session.userId, kind).map((item) => item.payload), ...tombstones].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)),
    });
}

async function mergeGenerationHistory(request: Request, session: SessionPayload, kind: GenerationHistoryKind) {
    const body = await readJson<{ items?: unknown }>(request, 16 * 1024 * 1024);
    const items = normalizeGenerationHistory(kind, body.items, (storageKey) => state.assets[assetKey(session.userId, storageKey)]);
    appDatabase.upsertGenerationHistoryItems(session.userId, kind, items);
    return listGenerationHistory(session, kind);
}

async function deleteGenerationHistoryItems(request: Request, session: SessionPayload, kind: GenerationHistoryKind) {
    const deletion = normalizeGenerationHistoryDeletion(await readJson<unknown>(request, 512 * 1024));
    const existing = appDatabase.loadGenerationHistory(session.userId, kind);
    const allHistory = [...(kind === "image" ? existing : appDatabase.loadGenerationHistory(session.userId, "image")), ...(kind === "video" ? existing : appDatabase.loadGenerationHistory(session.userId, "video"))];
    const selectedIds = new Set(deletion.ids);
    const remainingJobIds = new Set(
        allHistory
            .filter((item) => item.kind !== kind || !selectedIds.has(item.id))
            .flatMap((item) => (Array.isArray(item.payload.serverJobIds) ? item.payload.serverJobIds : []))
            .map((id) => String(id || "").trim())
            .filter(Boolean),
    );
    const relatedJobIds = generationHistoryJobIdsForDeletion(kind, deletion.ids, allHistory);
    const hiddenJobIds = new Set(relatedJobIds);
    for (const id of deletion.jobIds) {
        if (remainingJobIds.has(id)) continue;
        const job = imageQueue.get(id);
        if (!job || job.input.userId !== session.userId || job.input.source?.route !== "/image" || ["queued", "running"].includes(job.status)) continue;
        hiddenJobIds.add(id);
    }
    const deletedAt = Date.now();
    const tombstoneIds = new Set(deletion.ids);
    for (const id of hiddenJobIds) {
        const fallbackId = `server-job:${id}`;
        if (fallbackId.length <= 180) tombstoneIds.add(fallbackId);
    }
    appDatabase.deleteGenerationHistoryItems(
        session.userId,
        kind,
        Array.from(tombstoneIds).map((id) => ({ id, kind, deletedAt, jobIds: Array.from(hiddenJobIds) })),
    );

    let removedJobs = 0;
    for (const id of relatedJobIds) {
        const job = imageQueue.get(id);
        if (!job || job.input.userId !== session.userId || ["queued", "running"].includes(job.status)) continue;
        if (!imageQueue.remove(id)) continue;
        delete state.jobs[id];
        appDatabase.deleteJob(id);
        cleanupJobFiles(job);
        removedJobs += 1;
    }

    return json({ deleted: deletion.ids.length, removedJobs });
}

async function saveGenerationHistoryItem(request: Request, session: SessionPayload, kind: GenerationHistoryKind, id: string) {
    const body = await readJson<{ item?: unknown }>(request, 1024 * 1024);
    const tombstone = appDatabase.loadGenerationHistoryTombstones(session.userId, kind).find((item) => item.id === id);
    if (tombstone) return json({ item: { id, createdAt: tombstone.deletedAt, updatedAt: tombstone.deletedAt, deletedAt: tombstone.deletedAt } });
    const item = normalizeGenerationHistoryItem(kind, body.item, id, (storageKey) => state.assets[assetKey(session.userId, storageKey)]);
    appDatabase.upsertGenerationHistoryItems(session.userId, kind, [item]);
    return json({ item: item.payload });
}

function deleteGenerationHistoryItem(session: SessionPayload, kind: GenerationHistoryKind, id: string) {
    const deletedAt = Date.now();
    appDatabase.deleteGenerationHistoryItems(session.userId, kind, [{ id, kind, deletedAt, jobIds: [] }]);
    return new Response(null, { status: 204 });
}

async function uploadAsset(request: Request, session: SessionPayload) {
    const { form, file } = await readAssetUploadForm(request, MAX_ASSET_UPLOAD_BYTES, MAX_ASSET_BYTES, "上传请求不能超过 32 MB", "单个素材不能超过 32 MB");
    const prefix = normalizeAssetPrefix(form.get("prefix"));
    const requestedKey = String(form.get("storageKey") || "").trim();
    const key = requestedKey || `${prefix}:${randomUUID()}`;
    if (!new RegExp(`^${escapeRegExp(prefix)}:[A-Za-z0-9._:-]{1,180}$`).test(key)) throw new HttpError(400, "素材标识无效");
    if (key === AVATAR_ASSET_KEY) throw new HttpError(400, "请通过个人头像入口上传头像");
    const kind = assetKindForPrefix(prefix);
    const maxBytes = assetByteLimit(kind);
    if (file.size > maxBytes) throw new HttpError(413, `${assetKindLabel(kind)}不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`);
    const mimeType =
        kind === "image"
            ? await resolveImageMimeType(file)
            : kind === "audio" || kind === "video"
              ? await resolveMediaMimeType(file, kind)
              : "application/octet-stream";
    if (kind === "image" && !isAllowedImageMimeType(mimeType)) throw new HttpError(400, "图片素材格式无效，仅支持 PNG、JPEG、WebP 或 AVIF");
    if ((kind === "audio" || kind === "video") && !isAllowedMediaMimeType(mimeType, kind)) throw new HttpError(400, `${assetKindLabel(kind)}格式无效或文件内容与扩展名不一致`);
    const { asset, replaced } = await storeAsset(session, key, file, mimeType);
    return json({ asset: publicAsset(asset) }, replaced ? 200 : 201);
}

async function promoteJobAsset(request: Request, session: SessionPayload) {
    const body = await readJson<{ sourceUrl?: string }>(request, 4 * 1024);
    const sourceUrl = String(body.sourceUrl || "").trim();
    const match = sourceUrl.match(/^\/api\/job-files\/([^/?#]+)\/([^/?#]+)$/);
    if (!match) throw new HttpError(400, "任务图片地址无效");
    let jobId: string;
    let filename: string;
    try {
        jobId = decodeURIComponent(match[1]);
        filename = decodeURIComponent(match[2]);
    } catch {
        throw new HttpError(400, "任务图片地址无效");
    }
    const job = ownedJob(session.userId, jobId);
    const image = job.result?.images.find((item) => item.dataUrl === sourceUrl);
    if (!image) throw new HttpError(404, "任务图片不存在");
    const path = join(JOB_FILE_ROOT, safeSegment(session.userId), safeSegment(jobId), safeSegment(filename));
    if (!existsSync(path)) throw new HttpError(404, "任务图片文件不存在");
    const file = Bun.file(path);
    const mimeType = isAllowedImageMimeType(image.mimeType) ? image.mimeType : await resolveImageMimeType(file);
    if (!isAllowedImageMimeType(mimeType)) throw new HttpError(400, "图片素材格式无效");
    const dimensions =
        Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && (image.width || 0) > 0 && (image.height || 0) > 0
            ? { width: image.width!, height: image.height! }
            : readImageDimensions(new Uint8Array(await file.arrayBuffer()), mimeType);
    const { asset } = await storeAsset(session, `image:${randomUUID()}`, file, mimeType);
    return json({ asset: publicAsset(asset), sourceUrl, ...(dimensions || {}) }, 201);
}

async function uploadProfileAvatar(request: Request, session: SessionPayload) {
    const { file } = await readAssetUploadForm(request, MAX_AVATAR_UPLOAD_BYTES, MAX_AVATAR_BYTES, "头像文件不能超过 2 MB", "头像文件不能超过 2 MB");
    const mimeType = await resolveImageMimeType(file);
    if (!isAllowedImageMimeType(mimeType)) throw new HttpError(400, "头像格式无效，仅支持 PNG、JPEG、WebP 或 AVIF");
    const { asset, replaced } = await storeAsset(session, AVATAR_ASSET_KEY, file, mimeType);
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

async function storeAsset(session: SessionPayload, key: string, file: Blob, mimeType: string) {
    return withAssetMutation(async () => {
        const recordKey = assetKey(session.userId, key);
        const existing = state.assets[recordKey];
        const usedBytes = assetBytesByUser.get(session.userId) || 0;
        if (usedBytes - (existing?.bytes || 0) + file.size > MAX_USER_ASSET_BYTES) throw new HttpError(413, "服务端素材空间不足，请删除不再使用的素材");
        assertDiskCapacity(Math.max(0, file.size - (existing?.bytes || 0)));
        const directory = assetDirectory(session.userId);
        mkdirSync(directory, { recursive: true });
        const finalPath = assetPath(session.userId, key);
        const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
        const backupPath = `${finalPath}.${randomUUID()}.bak`;
        let installed = false;
        let priorMoved = false;
        let databaseSaved = false;
        const asset: StoredAsset = {
            key,
            userId: session.userId,
            mimeType,
            bytes: file.size,
            createdAt: nextAssetVersion(existing?.createdAt),
        };
        try {
            await Bun.write(temporaryPath, file);
            if (existsSync(finalPath)) {
                renameSync(finalPath, backupPath);
                priorMoved = true;
            }
            renameSync(temporaryPath, finalPath);
            installed = true;
            appDatabase.saveAsset(asset);
            databaseSaved = true;
            state.assets[recordKey] = asset;
            assetBytesByUser.set(session.userId, usedBytes - (existing?.bytes || 0) + asset.bytes);
            removeAssetFileBestEffort(backupPath, asset, "asset_backup_cleanup_failed");
            const legacyPath = legacyAssetPath(session.userId, key);
            if (legacyPath !== finalPath) removeAssetFileBestEffort(legacyPath, asset, "legacy_asset_cleanup_failed");
            return { asset, replaced: Boolean(existing) };
        } catch (error) {
            rmSync(temporaryPath, { force: true });
            if (!databaseSaved) {
                if (installed) rmSync(finalPath, { force: true });
                if (priorMoved && existsSync(backupPath)) renameSync(backupPath, finalPath);
            }
            throw error;
        }
    });
}

function serveAsset(request: Request, session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    return serveStoredAsset(request, asset);
}

function serveProfileAvatar(request: Request, session: SessionPayload, userId: string) {
    const requesterIsAdmin = Boolean(state.users[session.userId]?.admin);
    if (!canAccessUserAvatar(session.userId, userId, requesterIsAdmin)) throw new HttpError(403, "无权查看该用户头像");
    return serveStoredAsset(request, ownedAsset(userId, AVATAR_ASSET_KEY));
}

function serveStoredAsset(request: Request, asset: StoredAsset) {
    const path = existingAssetPath(asset.userId, asset.key);
    if (!path) throw new HttpError(404, "素材文件不存在");
    const etag = `"${createHash("sha256").update(`${asset.key}:${asset.createdAt}:${asset.bytes}`).digest("hex").slice(0, 24)}"`;
    const file = Bun.file(path);
    const size = file.size;
    const cacheControl = assetCacheControl(request.url, asset.createdAt);
    const rangeHeader = request.headers.get("if-range") && request.headers.get("if-range") !== etag ? null : request.headers.get("range");
    const range = parseSingleByteRange(rangeHeader, size);
    if (range === "invalid")
        return new Response(null, {
            status: 416,
            headers: {
                "Content-Range": `bytes */${size}`,
                "Accept-Ranges": "bytes",
                ETag: etag,
                "Cache-Control": cacheControl,
                Vary: "Cookie",
            },
        });
    if (!range && request.headers.get("if-none-match") === etag)
        return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Accept-Ranges": "bytes", "Cache-Control": cacheControl, Vary: "Cookie" },
        });
    const headers = new Headers({
        "Content-Type": asset.mimeType,
        "Content-Length": String(range ? range.end - range.start + 1 : size),
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        Vary: "Cookie",
        ETag: etag,
    });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(request.method === "HEAD" ? null : range ? file.slice(range.start, range.end + 1, asset.mimeType) : file, {
        status: range ? 206 : 200,
        headers,
    });
}

async function deleteAsset(session: SessionPayload, key: string) {
    await removeAsset(session, key);
    return new Response(null, { status: 204 });
}

async function removeAsset(session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    const paths = [assetPath(session.userId, asset.key)];
    const legacyPath = legacyAssetPath(session.userId, asset.key);
    if (!legacyAssetPathShared(session.userId, asset.key)) paths.push(legacyPath);
    return withAssetMutation(async () => {
        delete state.assets[assetKey(session.userId, key)];
        appDatabase.deleteAsset(session.userId, key);
        assetBytesByUser.set(session.userId, Math.max(0, (assetBytesByUser.get(session.userId) || 0) - asset.bytes));
        try {
            for (const path of new Set(paths)) if (existsSync(path)) unlinkSync(path);
        } catch (error) {
            console.warn(
                JSON.stringify({
                    event: "asset_file_cleanup_failed",
                    key: asset.key,
                    message: error instanceof Error ? error.message : "unknown error",
                }),
            );
        }
    });
}

function publicAsset(asset: StoredAsset) {
    return {
        key: asset.key,
        url: assetUrl(asset.key, asset.createdAt),
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        createdAt: asset.createdAt,
    };
}

function avatarUrlFor(userId: string) {
    const asset = state.assets[assetKey(userId, AVATAR_ASSET_KEY)];
    return asset ? `/api/profile/avatar/${encodeURIComponent(userId)}?v=${asset.createdAt}` : "";
}

function assetUrl(key: string, version?: number) {
    return `/api/assets/${encodeURIComponent(key)}${version ? `?v=${version}` : ""}`;
}

async function createImageJob(request: Request, session: SessionPayload) {
    const idempotencyKey = requiredIdempotencyKey(request);
    const jobId = createHash("sha256").update(`${session.userId}:${idempotencyKey}`).digest("hex");
    const existingBeforeRead = state.jobs[jobId];
    if (existingBeforeRead) return json({ job: publicJob(existingBeforeRead) }, 200);
    const body = await readJson<Partial<ImageJobInput>>(request, MAX_IMAGE_JOB_JSON_BYTES);
    const channelId = String(body.channelId || "");
    const channel = platformChannel(channelId);
    const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)));
    const references = Array.isArray(body.references) ? body.references.map(String) : [];
    if (references.length > 16) throw new HttpError(400, "参考图最多 16 张");
    const referenceBytes = references.reduce((total, reference) => total + assertSafeDataImage(reference), 0);
    const maskBytes = body.mask ? assertSafeDataImage(String(body.mask)) : 0;
    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new HttpError(400, "提示词不能为空");
    if (prompt.length > MAX_PROMPT_CHARS) throw new HttpError(400, `提示词不能超过 ${MAX_PROMPT_CHARS.toLocaleString()} 个字符`);
    assertDiskCapacity(referenceBytes + maskBytes);
    const existing = state.jobs[jobId];
    if (existing) return json({ job: publicJob(existing) }, 200);
    const model = String(body.model || "").trim();
    if (!model) throw new HttpError(400, "模型不能为空");
    assertPlatformModelAllowed(channelId, model, "image");
    const resolution = optionalString(body.quality);
    const isUuGptImage2 = isUuAsyncGptImage2Channel(channel.baseUrl, model);
    const imageQuality = isUuGptImage2 ? undefined : normalizeImageQuality(body.imageQuality);
    const imageOutputFormat = isUuGptImage2 ? undefined : normalizeImageOutputFormat(body.imageOutputFormat, model);
    cultivation?.reserveGeneration({
        jobId,
        userId: session.userId,
        channelId,
        model,
        count,
        quality: resolution,
        referenceCount: references.length,
        hasMask: Boolean(body.mask),
        activeJobs: activeUserJobs(session.userId),
    });
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
        cleanupJobFilesFor(session.userId, jobId);
        cultivation?.refundGeneration(jobId, "job creation failed");
        throw error;
    }
}

function listJobs(session: SessionPayload) {
    const hiddenJobIds = new Set([
        ...appDatabase.loadGenerationHistoryTombstones(session.userId, "image").flatMap((item) => item.jobIds),
        ...appDatabase.loadGenerationHistoryTombstones(session.userId, "video").flatMap((item) => item.jobIds),
    ]);
    return json({
        items: imageQueue
            .list()
            .filter((job) => job.input.userId === session.userId && !hiddenJobIds.has(job.id))
            .map(publicJob),
    });
}

function getJob(session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    return json({ job: publicJob(job) });
}

async function retryJob(request: Request, session: SessionPayload, id: string) {
    const source = ownedJob(session.userId, id);
    if (["queued", "running"].includes(source.status)) throw new HttpError(409, "任务仍在运行");
    const idempotencyKey = requiredIdempotencyKey(request);
    const jobId = createHash("sha256").update(`${session.userId}:retry:${id}:${idempotencyKey}`).digest("hex");
    const existing = state.jobs[jobId];
    if (existing) return json({ job: publicJob(existing) }, 200);
    const activeRetry = imageQueue.list().find((job) => job.input.userId === session.userId && job.input.retryOf === id && ["queued", "running"].includes(job.status));
    if (activeRetry) return json({ job: publicJob(activeRetry) }, 200);
    cultivation?.reserveGeneration({
        jobId,
        userId: session.userId,
        channelId: source.input.channelId,
        model: source.input.model,
        count: source.input.count,
        quality: source.input.quality,
        referenceCount: source.input.references.length,
        hasMask: Boolean(source.input.mask),
        activeJobs: activeUserJobs(session.userId),
    });
    try {
        const input = await copyImageJobInputForRetry(source.input, jobId, id);
        const job = imageQueue.add(input, jobId);
        return json({ job: publicJob(job) }, 202);
    } catch (error) {
        cleanupJobFilesFor(session.userId, jobId);
        cultivation?.refundGeneration(jobId, "retry job creation failed");
        throw error;
    }
}

async function copyImageJobInputForRetry(input: ImageJobInput, jobId: string, retryOf: string): Promise<ImageJobInput> {
    const references = await Promise.all(input.references.map(async (reference, index) => persistReference(DATA_DIR, input.userId, jobId, index, await materializeStoredImage(reference))));
    const mask = input.mask ? persistReference(DATA_DIR, input.userId, jobId, 10_000, await materializeStoredImage(input.mask)) : undefined;
    const upstream = input.upstream && !["failed", "canceled", "unknown"].includes(input.upstream.status || "pending") ? { ...input.upstream } : undefined;
    return { ...input, references, mask, retryOf: input.retryOf || retryOf, upstream };
}

async function deleteJob(url: URL, session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    if (["queued", "running"].includes(job.status)) {
        const previousStatus = job.status;
        if (imageQueue.cancel(id)) {
            if (previousStatus === "queued") cultivation?.refundGeneration(id, "user canceled before submission");
            else cultivation?.consumeGeneration(id, Math.max(0, Date.now() - (job.startedAt || Date.now())));
            void cancelUuImageTask(job.input).catch((error) =>
                console.warn(
                    JSON.stringify({
                        event: "uu_async_cancel_failed",
                        jobId: id,
                        message: error instanceof Error ? error.message : "unknown error",
                    }),
                ),
            );
        }
        return json({ job: publicJob(imageQueue.get(id)!) });
    }
    if (url.searchParams.get("remove") === "1") {
        if (!imageQueue.remove(id)) throw new HttpError(409, "任务仍在运行，无法移除");
        delete state.jobs[id];
        appDatabase.deleteJob(id);
        cleanupJobFiles(job);
        return new Response(null, { status: 204 });
    }
    return json({ job: publicJob(job) });
}

function publicJob(job: StoredImageJob) {
    const channel = resolvePlatformChannel(state, job.input.channelId);
    const usesUuAsync = job.input.apiFormat === "openai" && job.input.count === 1 && Boolean(channel && isUuImageAsyncChannel(channel.baseUrl, job.input.model, job.input.references.length, Boolean(job.input.mask)));
    const phase = job.status === "queued" ? "queued" : job.status !== "running" ? "completed" : usesUuAsync && !hasUuAsyncTask(job.input) ? "submitting" : "waiting_upstream";
    return {
        id: job.id,
        status: job.status,
        phase,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        prompt: job.input.prompt,
        model: job.input.model,
        count: job.input.count,
        channelId: job.input.channelId,
        quality: job.input.quality,
        imageQuality: job.input.imageQuality,
        imageOutputFormat: job.input.imageOutputFormat,
        size: job.input.size,
        source: job.input.source,
        result: job.result,
    };
}

async function runImageJob(input: ImageJobInput, signal: AbortSignal, job: QueueJob<ImageJobInput, ImageJobOutput>) {
    const startedAt = Date.now();
    const upstreamRequestId = input.retryOf || job.id;
    try {
        const channel = platformChannel(input.channelId);
        const apiKey = decryptChannelApiKey(channel);
        const useUuAsync = input.apiFormat === "openai" && (hasUuAsyncTask(input) || (input.count === 1 && isUuImageAsyncChannel(channel.baseUrl, input.model, input.references.length, Boolean(input.mask))));
        const rawImages =
            input.apiFormat === "gemini"
                ? await generateGeminiImages(channel, apiKey, await materializeImageInput(input), signal, upstreamRequestId)
                : useUuAsync
                  ? await generateUuAsyncImages(channel, apiKey, input, job, signal, upstreamRequestId)
                  : await generateOpenAiImages(channel, apiKey, await materializeImageInput(input), signal, upstreamRequestId);
        const images: ImageJobImage[] = [];
        for (const raw of rawImages) {
            if (signal.aborted || job.status === "canceled") throw abortError(signal);
            images.push(await persistJobImage(input.userId, job.id, raw, Date.now() - startedAt, signal));
        }
        if (!images.length) throw new Error("上游接口没有返回图片");
        const result = {
            images,
            successCount: images.length,
            failCount: Math.max(0, input.count - images.length),
            durationMs: Date.now() - startedAt,
        };
        cultivation?.settleGeneration({
            jobId: job.id,
            successCount: result.successCount,
            failCount: result.failCount,
            durationMs: result.durationMs,
        });
        return result;
    } catch (error) {
        cleanupJobOutputFilesFor(input.userId, job.id);
        if (job.status !== "canceled") cultivation?.refundGeneration(job.id, error instanceof Error ? error.message : "generation failed");
        throw error;
    }
}

async function materializeImageInput(input: ImageJobInput): Promise<RuntimeImageJobInput> {
    return {
        ...input,
        references: await Promise.all(input.references.map(materializeStoredImage)),
        mask: input.mask ? await materializeStoredImage(input.mask) : undefined,
    };
}

async function materializeStoredImage(reference: string | StoredImageReference) {
    if (typeof reference === "string") return reference;
    const path = resolve(DATA_DIR, reference.path);
    if (!(path === DATA_DIR || path.startsWith(`${DATA_DIR}${sep}`)) || !existsSync(path)) throw new HttpError(404, "参考图文件不存在");
    const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
    return `data:${reference.mimeType};base64,${bytes.toString("base64")}`;
}

type RuntimeImageJobInput = Omit<ImageJobInput, "references" | "mask"> & {
    references: string[];
    mask?: string;
};

async function generateOpenAiImages(channel: ChannelRecord, apiKey: string, input: RuntimeImageJobInput, signal: AbortSignal, upstreamRequestId: string) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": upstreamIdempotencyKey(upstreamRequestId),
    };
    // Compatible gateways do not consistently honor idempotency keys. Never replay a paid synchronous generation automatically.
    const retryPaidRequest = false;
    const size = resolveOpenAiImageSize(input.size, input.quality);
    const requestOptions = buildOpenAiImageRequestOptions({
        count: input.count,
        quality: input.imageQuality,
        outputFormat: input.imageOutputFormat,
        size,
        background: input.background,
    });
    let response: Response;
    if (isSadaiImage2Channel(channel.baseUrl, input.model) && !input.mask) {
        response = await upstreamFetch(
            buildUpstreamUrl(channel.baseUrl, "openai", input.references.length ? "/images/edits" : "/images/generations"),
            {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: input.model,
                    prompt: input.prompt,
                    ...buildSadaiImageRequestOptions({
                        count: input.count,
                        size: input.size,
                        outputResolution: input.quality,
                        generationQuality: input.imageQuality,
                        references: input.references,
                    }),
                }),
                signal,
            },
            retryPaidRequest,
        );
    } else if (usesJsonReferenceGeneration(channel.baseUrl, input.model, input.references.length, Boolean(input.mask))) {
        response = await upstreamFetch(
            buildUpstreamUrl(channel.baseUrl, "openai", "/images/generations"),
            {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: input.model,
                    prompt: input.prompt,
                    image: input.references,
                    ...requestOptions,
                }),
                signal,
            },
            retryPaidRequest,
        );
    } else if (input.references.length) {
        const form = new FormData();
        form.set("model", input.model);
        form.set("prompt", input.prompt);
        Object.entries(requestOptions).forEach(([key, value]) => form.set(key, String(value)));
        input.references.forEach((dataUrl, index) => form.append("image", dataUrlBlob(dataUrl), `reference-${index + 1}.png`));
        if (input.mask) form.set("mask", dataUrlBlob(input.mask), "mask.png");
        response = await upstreamFetch(buildUpstreamUrl(channel.baseUrl, "openai", "/images/edits"), { method: "POST", headers, body: form, signal }, retryPaidRequest);
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
            retryPaidRequest,
        );
    }
    const payload = await parseUpstreamJson(response, {
        maxBytes: MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES,
        tooLargeMessage: "上游内嵌图片响应过大，请将单次生成张数调低后重试",
    });
    const data = imageResponseItems(payload);
    const mimeType = imageOutputFormatMimeType(input.imageOutputFormat);
    return data.map((item) => (typeof item?.b64_json === "string" ? base64ImageDataUrl(item.b64_json, mimeType) : typeof item?.url === "string" ? item.url : "")).filter(Boolean);
}

async function generateUuAsyncImages(channel: ChannelRecord, apiKey: string, input: ImageJobInput, job: QueueJob<ImageJobInput, ImageJobOutput>, signal: AbortSignal, upstreamRequestId: string) {
    if (!hasUuAsyncTask(input)) {
        const runtimeInput = await materializeImageInput(input);
        const requestOptions = buildUuAsyncImageRequest({
            size: input.size,
            quality: input.quality,
            referenceCount: runtimeInput.references.length,
        });
        const form = new FormData();
        form.set("model", input.model);
        form.set("mode", requestOptions.mode);
        form.set("prompt", input.prompt);
        form.set("width", String(requestOptions.width));
        form.set("height", String(requestOptions.height));
        if (runtimeInput.references[0]) form.set("image", dataUrlBlob(runtimeInput.references[0]), "reference.png");

        const response = await upstreamFetch(
            buildUpstreamUrl(channel.baseUrl, "openai", "/images/generations/async"),
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Idempotency-Key": upstreamIdempotencyKey(upstreamRequestId),
                },
                body: form,
                signal,
            },
            true,
            UU_ASYNC_REQUEST_TIMEOUT_MS,
        );
        const task = readUuAsyncTask(await parseUpstreamJson(response));
        if (!task.taskId) throw new Error(task.message || "UU 异步任务创建成功，但没有返回任务 ID");
        input.upstream = {
            provider: "uu-image",
            taskId: task.taskId,
            expiresAt: task.expiresAt,
            status: task.status,
        };
        await imageQueue.touch(job.id);
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
    const channel = platformChannel(input.channelId);
    const apiKey = decryptChannelApiKey(channel);
    const response = await upstreamFetch(
        buildUpstreamUrl(channel.baseUrl, "openai", `/images/generations/tasks/${encodeURIComponent(input.upstream.taskId)}`),
        { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } },
        false,
        UU_ASYNC_REQUEST_TIMEOUT_MS,
    );
    await response.body?.cancel();
}

function hasUuAsyncTask(input: ImageJobInput): input is ImageJobInput & {
    upstream: NonNullable<ImageJobInput["upstream"]>;
} {
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

async function generateGeminiImages(channel: ChannelRecord, apiKey: string, input: RuntimeImageJobInput, signal: AbortSignal, upstreamRequestId: string) {
    const outputs = await Promise.all(
        Array.from({ length: input.count }, async (_, index) => {
            return geminiImageSemaphore.run(signal, async () => {
                const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
                input.references.forEach((dataUrl) => {
                    const parsed = parseDataUrl(dataUrl);
                    parts.push({
                        inlineData: { mimeType: parsed.mimeType, data: parsed.base64 },
                    });
                });
                const image: Record<string, string> = {};
                if (input.size && input.size !== "auto") image.aspectRatio = normalizeAspectRatio(input.size);
                if (input.quality && input.quality !== "auto") image.imageSize = ({ low: "1K", medium: "2K", high: "4K" } as Record<string, string>)[input.quality] || input.quality;
                const response = await upstreamFetch(
                    buildUpstreamUrl(channel.baseUrl, "gemini", `/models/${encodeURIComponent(input.model.replace(/^models\//, ""))}:generateContent`),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-goog-api-key": apiKey,
                            "Idempotency-Key": upstreamIdempotencyKey(upstreamRequestId, index),
                        },
                        body: JSON.stringify({
                            contents: [{ role: "user", parts }],
                            generationConfig: {
                                responseModalities: ["TEXT", "IMAGE"],
                                ...(Object.keys(image).length ? { responseFormat: { image } } : {}),
                            },
                        }),
                        signal,
                    },
                    true,
                );
                const payload = await parseUpstreamJson(response, {
                    maxBytes: MAX_UPSTREAM_INLINE_IMAGE_JSON_BYTES,
                    tooLargeMessage: "上游内嵌图片响应过大，请将单次生成张数调低后重试",
                });
                const candidates: Array<{ content?: { parts?: Array<Record<string, any>> } }> = Array.isArray(payload.candidates) ? payload.candidates : [];
                return candidates
                    .flatMap((candidate) => candidate.content?.parts || [])
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
    const outputPath = join(directory, filename);
    mkdirSync(directory, { recursive: true });
    assertDiskCapacity(bytes.byteLength);
    reserveJobOutputBytes(userId, jobId, bytes.byteLength);
    let persisted = false;
    try {
        await Bun.write(outputPath, bytes);
        if (signal.aborted) throw abortError(signal);
        const dimensions = readImageDimensions(bytes, mimeType);
        persisted = true;
        return {
            id: randomUUID(),
            dataUrl: `/api/job-files/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`,
            bytes: bytes.byteLength,
            durationMs,
            mimeType,
            ...(dimensions || {}),
        };
    } finally {
        if (!persisted) {
            rmSync(outputPath, { force: true });
            releaseJobOutputBytes(userId, jobId, bytes.byteLength);
        }
    }
}

function serveJobFile(request: Request, session: SessionPayload, jobId: string, filename: string) {
    ownedJob(session.userId, jobId);
    const safeName = safeSegment(filename);
    const path = join(JOB_FILE_ROOT, safeSegment(session.userId), safeSegment(jobId), safeName);
    const file = Bun.file(path);
    if (!existsSync(path)) throw new HttpError(404, "图片不存在");
    return new Response(request.method === "HEAD" ? null : file, {
        headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Length": String(file.size),
            "Cache-Control": "private, max-age=31536000, immutable",
            Vary: "Cookie",
        },
    });
}

async function proxyAiRequest(request: Request, session: SessionPayload, channelId: string, protocol: ProviderProtocol, path: string, requestId: string) {
    const channel = platformChannel(channelId);
    if (channel.apiFormat !== protocol) throw new HttpError(400, "渠道协议不匹配");
    const requestKind = proxyRequestKind(request.method, protocol, path);
    if (!requestKind) throw new HttpError(403, "该渠道请求必须通过受控任务接口执行");
    const mediaTaskRead = readMediaTaskRoute(request.method, protocol, path);
    if (mediaTaskRead && !mediaTasks?.isOwnedBy(session.userId, channelId, mediaTaskRead.kind, mediaTaskRead.taskId)) {
        throw new HttpError(404, "媒体任务不存在");
    }
    const apiKey = decryptChannelApiKey(channel);
    let target: string;
    try {
        target = buildUpstreamUrl(channel.baseUrl, protocol, path);
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "渠道地址无效");
    }
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
    let model = "";
    if (body) {
        const metadata = await readProxyRequestMetadata(headers.get("content-type") || "", body, proxyPathModel(protocol, path));
        model = metadata.model;
        if (metadata.promptCharacters > MAX_PROMPT_CHARS) throw new HttpError(400, `提示词不能超过 ${MAX_PROMPT_CHARS.toLocaleString()} 个字符`);
        assertPlatformModelAllowed(channelId, model, requestKind === "read" ? undefined : requestKind);
    }
    const isGenerationSubmission = request.method === "POST" && requestKind !== "read";
    const mediaTaskKind = mediaTaskSubmissionKind(protocol, path);
    const usageId = isGenerationSubmission ? createHash("sha256").update(`${session.userId}:media:${requiredIdempotencyKey(request)}`).digest("hex") : "";
    const cultivationService = isGenerationSubmission ? requireCultivation() : null;
    if (usageId && cultivationService?.getGenerationUsage(usageId)) {
        const existingTask = mediaTaskKind ? mediaTasks?.getByUsageId(usageId) : null;
        if (existingTask && existingTask.userId === session.userId && existingTask.channelId === channelId && existingTask.kind === mediaTaskKind) {
            return json({ id: existingTask.taskId, status: "queued", recovered: true }, 200, { "x-request-id": requestId });
        }
        throw new HttpError(409, "该生成请求已处理，请勿重复提交");
    }
    if (usageId && cultivationService) {
        cultivationService.reserveGeneration({
            jobId: usageId,
            userId: session.userId,
            channelId,
            model,
            count: 1,
            referenceCount: 0,
            hasMask: false,
            activeJobs: activeUserJobs(session.userId),
        });
        activeMediaProxyRequests.set(session.userId, (activeMediaProxyRequests.get(session.userId) || 0) + 1);
        activeMediaProxyUsageIds.add(usageId);
    }
    const startedAt = Date.now();
    let submitted = false;
    let response: Response;
    try {
        submitted = true;
        response = await upstreamFetch(`${target}${new URL(request.url).search}`, { method: request.method, headers, body, signal: request.signal }, Boolean(headers.get("idempotency-key")));
        if (response.ok && mediaTaskRead && request.method === "GET") {
            response = await trackMediaTaskResponse(response, channelId, mediaTaskRead, path);
        }
        if (usageId && cultivationService) {
            if (response.ok && mediaTaskKind) {
                if (!mediaTasks) throw new HttpError(503, "媒体任务归属存储暂不可用");
                const captured = await captureMediaTaskResponse(response);
                response = captured.response;
                mediaTasks.register({
                    usageId,
                    userId: session.userId,
                    channelId,
                    kind: mediaTaskKind,
                    taskId: captured.taskId,
                });
            }
            if (response.ok) cultivationService.consumeGeneration(usageId, Date.now() - startedAt);
            else cultivationService.refundGeneration(usageId, `upstream rejected media request (${response.status})`);
        }
    } catch (error) {
        if (usageId && cultivationService) {
            if (submitted) cultivationService.consumeGeneration(usageId, Date.now() - startedAt);
            else cultivationService.refundGeneration(usageId, "media request failed before submission");
        }
        throw error;
    } finally {
        if (usageId) {
            const next = Math.max(0, (activeMediaProxyRequests.get(session.userId) || 1) - 1);
            if (next) activeMediaProxyRequests.set(session.userId, next);
            else activeMediaProxyRequests.delete(session.userId);
            activeMediaProxyUsageIds.delete(usageId);
        }
    }
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-disposition", "cache-control"]) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("x-request-id", requestId);
    responseHeaders.set("x-upstream-status", String(response.status));
    return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
    });
}

function mediaTaskSubmissionKind(protocol: ProviderProtocol, path: string): MediaTaskKind | null {
    if (protocol !== "openai") return null;
    const normalizedPath = `/${path.replace(/^\/+/, "")}`;
    if (normalizedPath === "/videos") return "video";
    if (normalizedPath === "/contents/generations/tasks") return "content";
    return null;
}

function readMediaTaskRoute(method: string, protocol: ProviderProtocol, path: string): { kind: MediaTaskKind; taskId: string } | null {
    if (protocol !== "openai" || !["GET", "HEAD"].includes(method.toUpperCase())) return null;
    const normalizedPath = `/${path.replace(/^\/+/, "")}`;
    const video = normalizedPath.match(/^\/videos\/([^/]+)(?:\/content)?$/);
    const content = normalizedPath.match(/^\/contents\/generations\/tasks\/([^/]+)$/);
    const match = video || content;
    if (!match) return null;
    let taskId: string;
    try {
        taskId = decodeURIComponent(match[1]).trim();
    } catch {
        throw new HttpError(400, "媒体任务 ID 无效");
    }
    if (!taskId || taskId.length > 512 || /\p{C}/u.test(taskId)) throw new HttpError(400, "媒体任务 ID 无效");
    return { kind: video ? "video" : "content", taskId };
}

async function captureMediaTaskResponse(response: Response) {
    const bytes = await readResponseBytes(response, MAX_UPSTREAM_JSON_BYTES, "上游媒体任务响应过大");
    let payload: unknown;
    try {
        payload = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch {
        throw new HttpError(502, "上游媒体接口未返回有效任务信息");
    }
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : {};
    const taskId = String(root.id || data.id || "").trim();
    if (!taskId || taskId.length > 512 || /\p{C}/u.test(taskId)) throw new HttpError(502, "上游媒体接口未返回有效任务 ID");
    return {
        taskId,
        response: responseWithBytes(response, bytes),
    };
}

async function trackMediaTaskResponse(response: Response, channelId: string, task: { kind: MediaTaskKind; taskId: string }, path: string) {
    if (task.kind === "video" && /\/content\/?$/.test(path)) {
        mediaTasks?.markFinished(channelId, task.kind, task.taskId);
        return response;
    }
    const bytes = await readResponseBytes(response, MAX_UPSTREAM_JSON_BYTES, "上游媒体任务响应过大");
    try {
        const payload = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
        if (isTerminalMediaTaskPayload(payload)) mediaTasks?.markFinished(channelId, task.kind, task.taskId);
    } catch {
        // Preserve an unusual but successful provider response; the next poll may still expose a terminal state.
    }
    return responseWithBytes(response, bytes);
}

function isTerminalMediaTaskPayload(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const root = payload as Record<string, unknown>;
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : {};
    const status = String(data.status || data.state || root.status || root.state || "")
        .trim()
        .toLowerCase();
    if (["succeeded", "success", "completed", "done", "failed", "error", "cancelled", "canceled", "expired"].includes(status)) return true;
    const content = data.content && typeof data.content === "object" && !Array.isArray(data.content) ? (data.content as Record<string, unknown>) : {};
    return [data.video_url, data.result_url, data.url, content.video_url, content.url, root.video_url, root.result_url, root.url].some((value) => typeof value === "string" && value.trim());
}

function responseWithBytes(response: Response, bytes: Uint8Array) {
    return new Response(requestBody(bytes), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

async function readProxyRequestMetadata(contentType: string, body: Uint8Array, fallbackModel = "") {
    try {
        let model = "";
        let promptCharacters = 0;
        if (contentType.includes("application/json")) {
            const payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
            model = String(payload.model || fallbackModel).trim();
            promptCharacters = proxyPromptCharacterCount(payload);
        } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
            const form = await new Request("http://localhost", {
                method: "POST",
                headers: { "Content-Type": contentType },
                body: requestBody(body),
            }).formData();
            model = String(form.get("model") || fallbackModel).trim();
            promptCharacters = ["prompt", "input", "instructions"].reduce((total, key) => {
                const value = form.get(key);
                return total + (typeof value === "string" ? value.length : 0);
            }, 0);
        } else {
            throw new HttpError(400, "代理请求格式不受支持");
        }
        if (!model) throw new HttpError(400, "模型不能为空");
        return { model, promptCharacters };
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "代理请求内容格式无效");
    }
}

function proxyPromptCharacterCount(value: unknown, key = ""): number {
    if (typeof value === "string") return ["prompt", "input", "instructions", "text"].includes(key) ? value.length : 0;
    if (Array.isArray(value)) return value.reduce((total, item) => total + proxyPromptCharacterCount(item, key), 0);
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value as Record<string, unknown>).reduce((total, [entryKey, item]) => total + proxyPromptCharacterCount(item, entryKey), 0);
}

function assertPlatformModelAllowed(channelId: string, model: string, capability?: "image" | "video" | "text" | "audio") {
    const configured = platformChannelModels(state, channelId).find((item) => item.name === model);
    if (!configured) throw new HttpError(403, "该模型未在当前平台渠道中开放");
    if (capability && configured.capability !== capability) throw new HttpError(403, "该模型未开放当前生成能力");
}

async function saveProject(request: Request, session: SessionPayload, id: string) {
    const body = await readJson<{
        project?: Record<string, unknown>;
        revision?: number;
    }>(request, 8 * 1024 * 1024);
    if (!isValidProjectPayload(body.project, id)) throw new HttpError(400, "项目数据无效");
    const projects = (state.projects[session.userId] ||= {});
    const tombstone = state.projectTombstones[session.userId]?.[id];
    if (tombstone)
        return json(
            {
                error: {
                    message: "画布已删除，请新建画布后继续编辑",
                    code: "PROJECT_DELETED",
                },
                tombstone,
            },
            409,
        );
    const current = projects[id];
    if (current && Number(body.revision) !== current.revision)
        return json(
            {
                error: { message: "项目已在其他标签页更新", code: "REVISION_CONFLICT" },
                current,
            },
            409,
        );
    const projectBytes = Buffer.byteLength(JSON.stringify(body.project), "utf8");
    if (projectBytes > MAX_JSON_BYTES) throw new HttpError(413, "单个画布数据不能超过 8 MB");
    if (!current && Object.keys(projects).length >= MAX_PROJECTS_PER_USER) throw new HttpError(413, `每个用户最多保存 ${MAX_PROJECTS_PER_USER} 个画布`);
    const currentBytes = current ? Buffer.byteLength(JSON.stringify(current.project), "utf8") : 0;
    const totalBytes = Object.values(projects).reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item.project), "utf8"), 0);
    if (totalBytes - currentBytes + projectBytes > MAX_PROJECT_BYTES_PER_USER) throw new HttpError(413, `个人画布数据总量不能超过 ${Math.floor(MAX_PROJECT_BYTES_PER_USER / 1024 / 1024)} MB`);
    assertDiskCapacity(Math.max(0, projectBytes - currentBytes));
    const next = {
        project: body.project,
        revision: (current?.revision || 0) + 1,
        updatedAt: Date.now(),
    };
    appDatabase.saveProject(session.userId, id, next);
    projects[id] = next;
    return json(next);
}

function deleteProject(url: URL, session: SessionPayload, id: string) {
    const projects = state.projects[session.userId];
    const current = projects?.[id];
    const requestedRevision = Number(url.searchParams.get("revision") || 0);
    if (current && requestedRevision && requestedRevision !== current.revision)
        return json(
            {
                error: { message: "画布已在其他位置更新", code: "REVISION_CONFLICT" },
                current,
            },
            409,
        );
    const tombstones = (state.projectTombstones[session.userId] ||= {});
    const previous = tombstones[id];
    const nextTombstone = {
        revision: Math.max(current?.revision || 0, previous?.revision || 0) + 1,
        deletedAt: Date.now(),
    };
    appDatabase.deleteProjectWithTombstone(session.userId, id, nextTombstone);
    if (projects) delete projects[id];
    tombstones[id] = nextTombstone;
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
            if (attempt === attempts - 1 || init.signal?.aborted) break;
        }
        await Bun.sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
    if (lastError instanceof HttpError) throw lastError;
    if (init.signal?.aborted) throw abortError(init.signal);
    if (lastError instanceof DOMException && lastError.name === "TimeoutError") throw new HttpError(504, "上游接口响应超时");
    throw new HttpError(502, "无法连接上游接口，请检查渠道地址、网络或接口状态");
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
        throw new Error(readUpstreamNonJsonError(response.status, text));
    }
    if (!response.ok || payload?.error || (typeof payload?.code === "number" && payload.code !== 0)) {
        throw new Error(readUpstreamErrorMessage(payload) || `上游服务返回 ${response.status}`);
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
            const response = await upstreamFetch(
                target,
                {
                    headers: { "User-Agent": "InfiniteCanvas/1.0" },
                    signal: request.signal,
                },
                false,
                PROMPT_PROXY_TIMEOUT_MS,
            );
            if (!response.ok) throw new HttpError(response.status, `提示词资源加载失败：${response.status}`);
            const bytes = await readResponseBytes(response, MAX_PROMPT_PROXY_BYTES, "提示词资源过大");
            const contentType = promptAssetContentType(response.headers.get("content-type"), bytes);
            assertDiskCapacity(bytes.byteLength);
            await Promise.all([Bun.write(cachePath, bytes), Bun.write(`${cachePath}.meta.json`, JSON.stringify({ contentType, cachedAt: Date.now() }))]);
            prunePromptCache();
            return new Response(bytes, {
                headers: promptCacheHeaders(contentType, requestId),
            });
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
    touchPromptCacheEntry(path);
    return new Response(file, {
        headers: promptCacheHeaders(contentType, requestId, stale),
    });
}

function touchPromptCacheEntry(path: string) {
    const metadataPath = `${path}.meta.json`;
    if (!existsSync(metadataPath)) return;
    try {
        const now = new Date();
        utimesSync(metadataPath, now, now);
    } catch {
        // Cache access timestamps are best effort only.
    }
}

function prunePromptCache() {
    let entries: Array<{ path: string; metadataPath: string; bytes: number; accessedAt: number }>;
    try {
        entries = readdirSync(PROMPT_CACHE_ROOT, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name))
            .map((entry) => {
                const path = join(PROMPT_CACHE_ROOT, entry.name);
                const metadataPath = `${path}.meta.json`;
                const fileStat = statSync(path);
                const accessedAt = existsSync(metadataPath) ? statSync(metadataPath).mtimeMs : fileStat.mtimeMs;
                return { path, metadataPath, bytes: fileStat.size, accessedAt };
            })
            .sort((left, right) => left.accessedAt - right.accessedAt);
    } catch {
        return;
    }
    let totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
    while (entries.length > MAX_PROMPT_CACHE_ENTRIES || totalBytes > MAX_PROMPT_CACHE_BYTES) {
        const entry = entries.shift();
        if (!entry) break;
        totalBytes -= entry.bytes;
        rmSync(entry.path, { force: true });
        rmSync(entry.metadataPath, { force: true });
    }
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
        const metadata = (await Bun.file(`${path}.meta.json`).json()) as {
            contentType?: unknown;
        };
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
    const declared = String(header || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
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
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        throw new HttpError(400, "页面地址格式无效");
    }
    const relative = normalize(decoded)
        .replace(/^(\.\.[/\\])+/, "")
        .replace(/^[/\\]+/, "");
    let path = resolve(WEB_ROOT, relative || "index.html");
    if (!(path === WEB_ROOT || path.startsWith(`${WEB_ROOT}${sep}`)) || !existsSync(path) || statSync(path).isDirectory() || Bun.file(path).size === 0) path = join(WEB_ROOT, "index.html");
    const file = Bun.file(path);
    const immutable = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|svg)$/.test(path);
    const revalidate = path.endsWith("index.html") || path.endsWith("theme-init.js");
    return new Response(method === "HEAD" ? null : file, {
        headers: {
            "Content-Type": file.type || contentType(path),
            "Cache-Control": immutable ? "public, max-age=31536000, immutable" : revalidate ? "no-cache" : "public, max-age=3600",
        },
    });
}

function runtimeConfigResponse() {
    const config = {
        ANALYTICS_GA4_ID: sanitizeId(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: sanitizeId(process.env.ANALYTICS_BAIDU_ID),
        PUBLIC_MODE: true,
    };
    return new Response(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};`, {
        headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function withSecurityHeaders(response: Response, requestId: string, request: Request) {
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("cross-origin-resource-policy", "same-origin");
    headers.set("x-request-id", requestId);
    const pathname = new URL(request.url).pathname;
    if ((pathname.startsWith("/api/") || pathname === "/health" || pathname === "/config.js") && headers.get("content-type")?.includes("application/json")) {
        headers.set("cache-control", "no-store");
    }
    headers.set(
        "content-security-policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.googletagmanager.com https://hm.baidu.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https: data: blob:; font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'",
    );
    if (secureCookies) headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function errorResponse(error: unknown, requestId: string) {
    const status =
        error instanceof HttpError || error instanceof CultivationError
            ? error.status
            : error instanceof AssetLibraryInputError || error instanceof GenerationHistoryInputError
              ? 400
              : error instanceof DOMException && error.name === "TimeoutError"
                ? 504
                : 500;
    const publicError =
        error instanceof HttpError ||
        error instanceof CultivationError ||
        error instanceof AssetLibraryInputError ||
        error instanceof GenerationHistoryInputError ||
        (error instanceof DOMException && error.name === "TimeoutError");
    const message = publicError && error instanceof Error ? error.message : status === 500 ? "服务器内部错误" : "请求处理失败";
    console.error(
        JSON.stringify({
            event: "request_error",
            requestId,
            status,
            message,
            stack: error instanceof Error ? error.stack : undefined,
        }),
    );
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

function requiredIdempotencyKey(request: Request) {
    const value = request.headers.get("idempotency-key")?.trim() || "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new HttpError(400, "生成请求必须携带有效的幂等键");
    return value;
}

function upstreamIdempotencyKey(requestId: string, index = 0) {
    return createHash("sha256").update(`${requestId}:${index}`).digest("hex");
}

function enforceSameOrigin(request: Request) {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "跨站请求已拒绝");
    const origin = request.headers.get("origin");
    if (!origin) return;
    if (!isSameApplicationOrigin(request.url, origin, PUBLIC_BASE_URL)) throw new HttpError(403, "跨站请求已拒绝");
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
    let release: () => void = () => undefined;
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
    let release: () => void = () => undefined;
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

function platformChannel(id: string) {
    const channel = resolvePlatformChannel(state, id);
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
    for (const jobs of jobsByUser.values()) {
        jobs.sort((left, right) => (right.finishedAt || right.createdAt) - (left.finishedAt || left.createdAt));
        for (const [index, job] of jobs.entries()) {
            const finishedAt = job.finishedAt || job.createdAt;
            if (index < MAX_TERMINAL_JOBS_PER_USER && now - finishedAt < JOB_RETENTION_MS) continue;
            if (!imageQueue.remove(job.id)) continue;
            delete state.jobs[job.id];
            appDatabase.deleteJob(job.id);
            cleanupJobFiles(job);
        }
    }
}

function cleanupJobFiles(job: StoredImageJob) {
    cleanupJobFilesFor(job.input.userId, job.id);
}

function cleanupJobFilesFor(userId: string, jobId: string) {
    cleanupJobOutputFilesFor(userId, jobId);
    const safeUserId = safeSegment(userId);
    const safeJobId = safeSegment(jobId);
    removeJobDirectory(join(DATA_DIR, "job-references", safeUserId, safeJobId), jobId);
}

function cleanupJobOutputFilesFor(userId: string, jobId: string) {
    const trackedBytes = jobFileBytesByJob.get(jobId) || 0;
    if (trackedBytes) releaseJobOutputBytes(userId, jobId, trackedBytes);
    removeJobDirectory(join(JOB_FILE_ROOT, safeSegment(userId), safeSegment(jobId)), jobId);
}

function removeJobDirectory(path: string, jobId: string) {
    try {
        rmSync(path, {
            recursive: true,
            force: true,
            maxRetries: 2,
            retryDelay: 25,
        });
    } catch (error) {
        console.warn(
            JSON.stringify({
                event: "job_file_cleanup_failed",
                jobId,
                message: error instanceof Error ? error.message : "unknown error",
            }),
        );
    }
}

function reserveJobOutputBytes(userId: string, jobId: string, bytes: number) {
    const userBytes = jobFileBytesByUser.get(userId) || 0;
    if (userBytes + bytes > MAX_USER_JOB_FILE_BYTES) throw new HttpError(413, `个人任务文件总量不能超过 ${Math.floor(MAX_USER_JOB_FILE_BYTES / 1024 / 1024)} MB，请清理旧生成任务后重试`);
    jobFileBytesByUser.set(userId, userBytes + bytes);
    jobFileBytesByJob.set(jobId, (jobFileBytesByJob.get(jobId) || 0) + bytes);
}

function releaseJobOutputBytes(userId: string, jobId: string, bytes: number) {
    const released = Math.min(Math.max(0, bytes), jobFileBytesByJob.get(jobId) || 0);
    if (!released) return;
    const remainingJobBytes = Math.max(0, (jobFileBytesByJob.get(jobId) || 0) - released);
    if (remainingJobBytes) jobFileBytesByJob.set(jobId, remainingJobBytes);
    else jobFileBytesByJob.delete(jobId);
    const remainingUserBytes = Math.max(0, (jobFileBytesByUser.get(userId) || 0) - released);
    if (remainingUserBytes) jobFileBytesByUser.set(userId, remainingUserBytes);
    else jobFileBytesByUser.delete(userId);
}

function activeUserJobs(userId: string) {
    return (
        imageQueue.list().filter((job) => job.input.userId === userId && ["queued", "running"].includes(job.status)).length +
        (activeMediaProxyRequests.get(userId) || 0) +
        (mediaTasks?.countActiveForUser(userId) || 0)
    );
}

function ownedAsset(userId: string, key: string) {
    const asset = state.assets[assetKey(userId, key)];
    if (!asset) throw new HttpError(404, "素材不存在");
    return asset;
}

function assetKey(userId: string, key: string) {
    return `${userId}:${key}`;
}

function assetDirectory(userId: string) {
    return join(ASSET_ROOT, safeSegment(userId));
}

function assetPath(userId: string, key: string) {
    return join(assetDirectory(userId), assetStorageFilename(key));
}

function legacyAssetPath(userId: string, key: string) {
    return join(assetDirectory(userId), legacyAssetStorageFilename(key));
}

function existingAssetPath(userId: string, key: string) {
    const current = assetPath(userId, key);
    if (existsSync(current)) return current;
    const legacy = legacyAssetPath(userId, key);
    return existsSync(legacy) ? legacy : "";
}

function legacyAssetPathShared(userId: string, key: string) {
    const filename = legacyAssetStorageFilename(key);
    return Object.values(state.assets).some((asset) => asset.userId === userId && asset.key !== key && legacyAssetStorageFilename(asset.key) === filename);
}

function removeAssetFileBestEffort(path: string, asset: StoredAsset, event: string) {
    try {
        rmSync(path, { force: true });
    } catch (error) {
        console.warn(
            JSON.stringify({
                event,
                userId: asset.userId,
                key: asset.key,
                message: error instanceof Error ? error.message : "unknown error",
            }),
        );
    }
}

function requestBody(bytes: Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type StoredAssetKind = "image" | "video" | "audio" | "file";

function assetKindForPrefix(prefix: string): StoredAssetKind {
    if (prefix.startsWith("image")) return "image";
    if (prefix.startsWith("video")) return "video";
    if (prefix.startsWith("audio")) return "audio";
    return "file";
}

function assetByteLimit(kind: StoredAssetKind) {
    if (kind === "video") return MAX_VIDEO_ASSET_BYTES;
    if (kind === "audio") return MAX_AUDIO_ASSET_BYTES;
    return MAX_IMAGE_ASSET_BYTES;
}

function assetKindLabel(kind: StoredAssetKind) {
    if (kind === "image") return "图片";
    if (kind === "video") return "视频";
    if (kind === "audio") return "音频";
    return "文件";
}

function availableDiskBytes() {
    const stats = statfsSync(DATA_DIR);
    return Number(stats.bavail) * Number(stats.bsize);
}

function assertDiskCapacity(incomingBytes = 0) {
    try {
        if (availableDiskBytes() - Math.max(0, incomingBytes) < MIN_FREE_DISK_BYTES) throw new HttpError(507, `服务器磁盘可用空间不足，至少需要保留 ${Math.ceil(MIN_FREE_DISK_BYTES / 1024 / 1024)} MB`);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        console.warn(
            JSON.stringify({
                event: "disk_capacity_check_failed",
                message: error instanceof Error ? error.message : "unknown error",
            }),
        );
    }
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
    console.info(
        JSON.stringify({
            event: "http_request",
            requestId,
            method: request.method,
            path: url.pathname,
            status: response.status,
            durationMs,
        }),
    );
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

function healthResponse() {
    let databaseOk = false;
    let diskAvailableBytes = 0;
    try {
        databaseOk = Boolean(appDatabase.raw?.query("SELECT 1 AS ok").get());
    } catch {
        databaseOk = false;
    }
    try {
        diskAvailableBytes = availableDiskBytes();
    } catch {
        diskAvailableBytes = 0;
    }
    const diskOk = diskAvailableBytes >= MIN_FREE_DISK_BYTES;
    const healthy = !shuttingDown && databaseOk && diskOk;
    return json(
        {
            status: healthy ? "ok" : "unhealthy",
            version: APP_VERSION,
            commit: APP_COMMIT,
            checks: {
                database: databaseOk ? "ok" : "failed",
                disk: diskOk ? "ok" : "low",
                diskAvailableBytes,
                minimumFreeDiskBytes: MIN_FREE_DISK_BYTES,
                shuttingDown,
            },
        },
        healthy ? 200 : 503,
    );
}

function shutdown(signal: string) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    imageQueue.pause();
    backupManager?.stop();
    const gracefulServerStop = Promise.resolve(server.stop(false)).catch(() => undefined);
    shutdownPromise = (async () => {
        const deadline = Date.now() + SHUTDOWN_GRACE_MS;
        while ((imageQueue.activeCount() > 0 || activeMediaProxyUsageIds.size > 0) && Date.now() < deadline) await Bun.sleep(200);
        const unfinishedMediaUsageIds = [...activeMediaProxyUsageIds];
        for (const usageId of unfinishedMediaUsageIds) cultivation?.consumeGeneration(usageId, SHUTDOWN_GRACE_MS);
        if (imageQueue.activeCount() > 0 || unfinishedMediaUsageIds.length > 0) {
            await Promise.resolve(server.stop(true)).catch(() => undefined);
        } else {
            await Promise.race([gracefulServerStop, Bun.sleep(1_000)]);
        }
        try {
            writeState();
        } catch (error) {
            console.error(
                JSON.stringify({
                    event: "shutdown_state_flush_failed",
                    message: error instanceof Error ? error.message : "unknown error",
                }),
            );
        }
        const unfinishedJobs = imageQueue.activeCount();
        if (!unfinishedJobs) appDatabase.close();
        console.info(
            JSON.stringify({
                event: "server_stopped",
                signal,
                unfinishedJobs,
                unfinishedMediaRequests: unfinishedMediaUsageIds.length,
            }),
        );
        process.exit(0);
    })();
    return shutdownPromise;
}

function readAppVersion() {
    try {
        return readFileSync(join(import.meta.dir, "..", "VERSION"), "utf8").trim() || "unknown";
    } catch {
        return "unknown";
    }
}

function normalizeDisplayName(value: unknown) {
    const displayName = String(value || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 32);
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

function normalizeShortText(value: unknown, maxLength: number, label: string) {
    const text = String(value || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, maxLength);
    if (!text || /\p{C}/u.test(text)) throw new HttpError(400, `${label}无效`);
    return text;
}

function decodeRouteSegment(value: string, label: string) {
    try {
        const decoded = decodeURIComponent(value).trim();
        if (!decoded || decoded.length > 512 || /[\/\\]|\p{C}/u.test(decoded)) throw new Error("invalid");
        return decoded;
    } catch {
        throw new HttpError(400, `${label}无效`);
    }
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
    return {
        ...(route ? { route } : {}),
        ...(projectId ? { projectId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(label ? { label } : {}),
    };
}

function normalizeAssetPrefix(value: FormDataEntryValue | null) {
    const prefix = String(value || "file")
        .trim()
        .toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new HttpError(400, "素材类型无效");
    return prefix;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSafeDataImage(value: string) {
    try {
        return decodeImageDataUrl(value).bytes.byteLength;
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
    return new Blob([Buffer.from(parsed.base64, "base64")], {
        type: parsed.mimeType,
    });
}

function normalizeAspectRatio(value: string) {
    const dimensions = value.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return value;
    return `${dimensions[1]}:${dimensions[2]}`;
}

function imageExtension(mimeType: string) {
    return (
        (
            {
                "image/jpeg": ".jpg",
                "image/webp": ".webp",
                "image/avif": ".avif",
                "image/gif": ".gif",
            } as Record<string, string>
        )[mimeType] || ".png"
    );
}

function safeSegment(value: string) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function sanitizeId(value: string | undefined) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

function contentType(path: string) {
    return (
        (
            {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".svg": "image/svg+xml",
            } as Record<string, string>
        )[extname(path)] || "application/octet-stream"
    );
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

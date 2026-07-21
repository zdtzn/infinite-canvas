import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

import { createIdentityToken, createSessionToken, expiredSessionCookie, hashAccessCode, identityCookie, readCookie, readIdentityToken, readSessionToken, sessionCookie, verifyAccessCode, type SessionPayload } from "./lib/auth";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./lib/crypto-store";
import { JobQueue, type QueueJob } from "./lib/job-queue";
import { assertAllowedUpstreamUrl, buildUpstreamUrl, resolveAllowedRedirect, type ProviderProtocol } from "./lib/url-policy";

type UserRecord = SessionPayload & { createdAt: number; disabled?: boolean; loginHash?: string };
type ChannelRecord = {
    id: string;
    userId: string;
    name: string;
    baseUrl: string;
    apiFormat: ProviderProtocol;
    apiKey: EncryptedSecret;
    updatedAt: number;
};
type StoredProject = { project: Record<string, unknown>; revision: number; updatedAt: number };
type StoredAsset = { key: string; userId: string; mimeType: string; bytes: number; createdAt: number };
type ImageJobInput = {
    userId: string;
    channelId: string;
    apiFormat: ProviderProtocol;
    model: string;
    prompt: string;
    count: number;
    quality?: string;
    size?: string;
    background?: string;
    references: string[];
    mask?: string;
    source?: { route?: string; projectId?: string; nodeId?: string; label?: string };
};
type ImageJobImage = { id: string; dataUrl: string; bytes: number; durationMs: number; mimeType: string };
type ImageJobOutput = { images: ImageJobImage[]; successCount: number; failCount: number; durationMs: number };
type StoredImageJob = QueueJob<ImageJobInput, ImageJobOutput>;
type ServerState = {
    version: 1;
    auth: { accessCodeHash: string; sessionSecret: string; adminUserId: string };
    users: Record<string, UserRecord>;
    channels: Record<string, ChannelRecord>;
    assets: Record<string, StoredAsset>;
    jobs: Record<string, StoredImageJob>;
    projects: Record<string, Record<string, StoredProject>>;
};

const PORT = positiveInt(process.env.PORT, 3000);
const DATA_DIR = resolve(process.env.DATA_DIR || "/data");
const WEB_ROOT = resolve(process.env.WEB_ROOT || "/app/web");
const STATE_PATH = join(DATA_DIR, "state.json");
const JOB_FILE_ROOT = join(DATA_DIR, "job-files");
const ASSET_ROOT = join(DATA_DIR, "assets");
const PROMPT_CACHE_ROOT = join(DATA_DIR, "prompt-cache");
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_USER_ASSET_BYTES = Math.max(MAX_ASSET_BYTES, positiveInt(process.env.MAX_USER_ASSET_BYTES, 2 * 1024 * 1024 * 1024));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const JOB_CONCURRENCY = Math.max(1, Math.min(4, positiveInt(process.env.JOB_CONCURRENCY, 2)));
const REQUEST_TIMEOUT_MS = Math.max(30_000, positiveInt(process.env.UPSTREAM_TIMEOUT_MS, 10 * 60_000));
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim();
const secureCookies = PUBLIC_BASE_URL.startsWith("https://");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JOB_FILE_ROOT, { recursive: true });
mkdirSync(ASSET_ROOT, { recursive: true });
mkdirSync(PROMPT_CACHE_ROOT, { recursive: true });

let state = loadState();
const encryptionSecret = process.env.APP_ENCRYPTION_KEY?.trim() || state.auth.sessionSecret;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let stateWriteQueued = false;

const imageQueue = new JobQueue<ImageJobInput, ImageJobOutput>({
    concurrency: JOB_CONCURRENCY,
    worker: runImageJob,
    onChange: (job) => {
        state.jobs[job.id] = job;
        queueStateWrite();
    },
});

for (const job of Object.values(state.jobs)) {
    if (job.status === "running") {
        job.status = "failed";
        job.error = "服务器重启时任务仍在运行，为避免重复扣费，请手动重试";
        job.finishedAt = Date.now();
    }
    imageQueue.restore(job);
}
queueStateWrite();

const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    idleTimeout: 255,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    async fetch(request) {
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
    if (url.pathname === "/health") return json({ status: "ok", version: 1, jobs: summarizeJobs(), uptimeSeconds: Math.round(process.uptime()) });
    if (url.pathname === "/config.js") return runtimeConfigResponse();
    if (url.pathname.startsWith("/prompt-proxy/")) return proxyPromptAsset(request, url, requestId);
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
        if (url.pathname === "/api/projects" && request.method === "GET") return json({ items: Object.values(state.projects[session.userId] || {}) });
        const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (projectMatch && request.method === "PUT") return saveProject(request, session, projectMatch[1]);
        if (projectMatch && request.method === "DELETE") return deleteProject(session, projectMatch[1]);
        const proxyMatch = url.pathname.match(/^\/api\/ai\/([^/]+)\/(openai|gemini)\/(.*)$/);
        if (proxyMatch) return proxyAiRequest(request, session, decodeURIComponent(proxyMatch[1]), proxyMatch[2] as ProviderProtocol, `/${proxyMatch[3]}`, requestId);
        return json({ error: { message: "接口不存在" }, requestId }, 404);
    }
    return serveStatic(url.pathname, request.method);
}

async function authStatus(request: Request) {
    const candidate = optionalSession(request);
    const session = candidate && !state.users[candidate.userId]?.disabled ? candidate : null;
    return json({ configured: Boolean(state.auth.accessCodeHash), authenticated: Boolean(session), user: session || null, publicMode: true });
}

async function setupAuth(request: Request) {
    if (state.auth.accessCodeHash) return json({ error: { message: "访问口令已经设置" } }, 409);
    enforceRateLimit(`setup:${clientIp(request)}`, 10);
    const body = await readJson<{ accessCode?: string; displayName?: string; personalCode?: string }>(request);
    const accessCode = String(body.accessCode || "").trim();
    const displayName = normalizeDisplayName(body.displayName);
    const personalCode = normalizePersonalCode(body.personalCode);
    if (accessCode.length < 8) return json({ error: { message: "访问口令至少 8 位" } }, 400);
    const userId = randomUUID();
    state.auth.accessCodeHash = await hashAccessCode(accessCode);
    state.auth.adminUserId = userId;
    state.users[userId] = { userId, displayName, admin: true, createdAt: Date.now(), loginHash: await hashAccessCode(personalCode) };
    writeState();
    return authenticatedResponse(state.users[userId]);
}

async function login(request: Request) {
    enforceRateLimit(`login:${clientIp(request)}`, 20);
    if (!state.auth.accessCodeHash) return json({ error: { message: "站点尚未初始化" } }, 409);
    const body = await readJson<{ accessCode?: string; displayName?: string; personalCode?: string }>(request);
    if (!(await verifyAccessCode(String(body.accessCode || ""), state.auth.accessCodeHash))) return json({ error: { message: "访问口令错误" } }, 401);
    const displayName = normalizeDisplayName(body.displayName);
    const personalCode = normalizePersonalCode(body.personalCode);
    const identityUserId = readIdentityToken(readCookie(request, "canvas_identity"), state.auth.sessionSecret);
    const existing = Object.values(state.users).find((user) => user.displayName.toLowerCase() === displayName.toLowerCase());
    if (existing?.disabled) return json({ error: { message: "当前账号已停用" } }, 403);
    if (existing?.loginHash && !(await verifyAccessCode(personalCode, existing.loginHash))) return json({ error: { message: "个人密码错误" } }, 401);
    if (existing && !existing.loginHash && existing.userId !== identityUserId) return json({ error: { message: "该旧账号尚未设置个人密码，请先在原设备登录后完成升级" } }, 409);
    const user = existing || { userId: randomUUID(), displayName, admin: false, createdAt: Date.now(), loginHash: await hashAccessCode(personalCode) };
    if (!user.loginHash) user.loginHash = await hashAccessCode(personalCode);
    state.users[user.userId] = user;
    writeState();
    return authenticatedResponse(user);
}

function authenticatedResponse(user: UserRecord) {
    const token = createSessionToken(user, state.auth.sessionSecret, SESSION_TTL_MS);
    const identity = createIdentityToken(user.userId, state.auth.sessionSecret);
    const headers = new Headers();
    headers.append("Set-Cookie", sessionCookie(token, secureCookies));
    headers.append("Set-Cookie", identityCookie(identity, secureCookies));
    return json({ authenticated: true, user: { userId: user.userId, displayName: user.displayName, admin: Boolean(user.admin) } }, 200, headers);
}

function logout() {
    return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie(secureCookies) });
}

function optionalSession(request: Request) {
    return readSessionToken(readCookie(request, "canvas_session"), state.auth.sessionSecret);
}

function requireSession(request: Request) {
    const session = optionalSession(request);
    if (!session) throw new HttpError(401, "请先登录");
    const user = state.users[session.userId];
    if (!user || user.disabled) throw new HttpError(403, "当前账号已停用");
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
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || file.size <= 0) throw new HttpError(400, "请选择需要上传的文件");
    if (file.size > MAX_ASSET_BYTES) throw new HttpError(413, "单个素材不能超过 64 MB");
    const prefix = normalizeAssetPrefix(form.get("prefix"));
    const requestedKey = String(form.get("storageKey") || "").trim();
    const key = requestedKey || `${prefix}:${randomUUID()}`;
    if (!new RegExp(`^${escapeRegExp(prefix)}:[A-Za-z0-9._:-]{1,180}$`).test(key)) throw new HttpError(400, "素材标识无效");
    const mimeType = String(file.type || "application/octet-stream").toLowerCase();
    if (prefix.startsWith("image") && !mimeType.startsWith("image/")) throw new HttpError(400, "图片素材格式无效");
    const recordKey = assetKey(session.userId, key);
    const existing = state.assets[recordKey];
    const usedBytes = Object.values(state.assets)
        .filter((asset) => asset.userId === session.userId)
        .reduce((total, asset) => total + asset.bytes, 0);
    if (usedBytes - (existing?.bytes || 0) + file.size > MAX_USER_ASSET_BYTES) throw new HttpError(413, "服务端素材空间不足，请删除不再使用的素材");
    const directory = join(ASSET_ROOT, safeSegment(session.userId));
    mkdirSync(directory, { recursive: true });
    await Bun.write(join(directory, safeSegment(key)), file);
    const asset: StoredAsset = { key, userId: session.userId, mimeType, bytes: file.size, createdAt: existing?.createdAt || Date.now() };
    state.assets[recordKey] = asset;
    writeState();
    return json({ asset: publicAsset(asset) }, existing ? 200 : 201);
}

function serveAsset(session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    const path = join(ASSET_ROOT, safeSegment(session.userId), safeSegment(asset.key));
    if (!existsSync(path)) throw new HttpError(404, "素材文件不存在");
    return new Response(Bun.file(path), { headers: { "Content-Type": asset.mimeType, "Content-Length": String(asset.bytes), "Cache-Control": "private, max-age=31536000, immutable" } });
}

function deleteAsset(session: SessionPayload, key: string) {
    const asset = ownedAsset(session.userId, key);
    const path = join(ASSET_ROOT, safeSegment(session.userId), safeSegment(asset.key));
    if (existsSync(path)) unlinkSync(path);
    delete state.assets[assetKey(session.userId, key)];
    writeState();
    return new Response(null, { status: 204 });
}

function publicAsset(asset: StoredAsset) {
    return { key: asset.key, url: `/api/assets/${encodeURIComponent(asset.key)}`, mimeType: asset.mimeType, bytes: asset.bytes, createdAt: asset.createdAt };
}

async function createImageJob(request: Request, session: SessionPayload) {
    const body = await readJson<Partial<ImageJobInput>>(request);
    const channelId = String(body.channelId || "");
    const channel = ownedChannel(session.userId, channelId);
    const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)));
    const references = Array.isArray(body.references) ? body.references.map(String) : [];
    if (references.length > 16) throw new HttpError(400, "参考图最多 16 张");
    references.forEach(assertSafeDataImage);
    if (body.mask) assertSafeDataImage(String(body.mask));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new HttpError(400, "提示词不能为空");
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (idempotencyKey) {
        const existing = Object.values(state.jobs).find((job) => job.input.userId === session.userId && job.id === idempotencyKey);
        if (existing) return json({ job: publicJob(existing) }, 200);
    }
    const input: ImageJobInput = {
        userId: session.userId,
        channelId,
        apiFormat: channel.apiFormat,
        model: String(body.model || "").trim(),
        prompt,
        count,
        quality: optionalString(body.quality),
        size: optionalString(body.size),
        background: optionalString(body.background),
        references,
        mask: optionalString(body.mask),
        source: body.source,
    };
    if (!input.model) throw new HttpError(400, "模型不能为空");
    const job = imageQueue.add(input, idempotencyKey || randomUUID());
    return json({ job: publicJob(job) }, 202);
}

function listJobs(session: SessionPayload) {
    return json({ items: imageQueue.list().filter((job) => job.input.userId === session.userId).map(publicJob) });
}

function getJob(session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    return json({ job: publicJob(job) });
}

function retryJob(session: SessionPayload, id: string) {
    const source = ownedJob(session.userId, id);
    if (["queued", "running"].includes(source.status)) throw new HttpError(409, "任务仍在运行");
    const job = imageQueue.add({ ...source.input, references: [...source.input.references] });
    return json({ job: publicJob(job) }, 202);
}

function deleteJob(url: URL, session: SessionPayload, id: string) {
    const job = ownedJob(session.userId, id);
    if (["queued", "running"].includes(job.status)) {
        imageQueue.cancel(id);
        return json({ job: publicJob(imageQueue.get(id)!) });
    }
    if (url.searchParams.get("remove") === "1") {
        imageQueue.remove(id);
        delete state.jobs[id];
        writeState();
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
    const channel = ownedChannel(input.userId, input.channelId);
    const apiKey = decryptSecret(channel.apiKey, encryptionSecret);
    const rawImages = input.apiFormat === "gemini" ? await generateGeminiImages(channel, apiKey, input, signal) : await generateOpenAiImages(channel, apiKey, input, signal);
    const images: ImageJobImage[] = [];
    for (const raw of rawImages) images.push(await persistJobImage(input.userId, job.id, raw, Date.now() - startedAt, signal));
    if (!images.length) throw new Error("上游接口没有返回图片");
    return { images, successCount: images.length, failCount: Math.max(0, input.count - images.length), durationMs: Date.now() - startedAt };
}

async function generateOpenAiImages(channel: ChannelRecord, apiKey: string, input: ImageJobInput, signal: AbortSignal) {
    const headers = { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": randomUUID() };
    let response: Response;
    if (input.references.length) {
        const form = new FormData();
        form.set("model", input.model);
        form.set("prompt", input.prompt);
        form.set("n", String(input.count));
        form.set("response_format", "b64_json");
        form.set("output_format", "png");
        if (input.quality) form.set("quality", input.quality);
        if (input.size) form.set("size", input.size);
        if (input.background) form.set("background", input.background);
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
                    n: input.count,
                    response_format: "b64_json",
                    output_format: "png",
                    ...(input.quality ? { quality: input.quality } : {}),
                    ...(input.size ? { size: input.size } : {}),
                    ...(input.background ? { background: input.background } : {}),
                }),
                signal,
            },
            true,
        );
    }
    const payload = await parseUpstreamJson(response);
    const data = Array.isArray(payload.data) ? payload.data : [];
    return data.map((item) => (typeof item?.b64_json === "string" ? `data:image/png;base64,${item.b64_json}` : typeof item?.url === "string" ? item.url : "")).filter(Boolean);
}

async function generateGeminiImages(channel: ChannelRecord, apiKey: string, input: ImageJobInput, signal: AbortSignal) {
    const outputs = await Promise.all(
        Array.from({ length: input.count }, async () => {
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
            const payload = await parseUpstreamJson(response);
            return (Array.isArray(payload.candidates) ? payload.candidates : [])
                .flatMap((candidate) => candidate?.content?.parts || [])
                .map((part) => {
                    const inline = part?.inlineData || part?.inline_data;
                    if (inline?.data) return `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}`;
                    return part?.fileData?.fileUri || "";
                })
                .filter(Boolean);
        }),
    );
    return outputs.flat();
}

async function persistJobImage(userId: string, jobId: string, value: string, durationMs: number, signal: AbortSignal): Promise<ImageJobImage> {
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
        bytes = new Uint8Array(await response.arrayBuffer());
        mimeType = response.headers.get("content-type")?.split(";")[0] || mimeType;
    }
    if (!mimeType.startsWith("image/") || bytes.byteLength > 32 * 1024 * 1024) throw new Error("上游返回的图片格式或大小不受支持");
    const extension = imageExtension(mimeType);
    const filename = `${randomUUID()}${extension}`;
    const directory = join(JOB_FILE_ROOT, safeSegment(userId), safeSegment(jobId));
    mkdirSync(directory, { recursive: true });
    await Bun.write(join(directory, filename), bytes);
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
    const apiKey = decryptSecret(channel.apiKey, encryptionSecret);
    const target = buildUpstreamUrl(channel.baseUrl, protocol, path);
    const headers = new Headers();
    for (const name of ["content-type", "accept", "idempotency-key"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    if (protocol === "gemini") headers.set("x-goog-api-key", apiKey);
    else headers.set("authorization", `Bearer ${apiKey}`);
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
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

async function saveProject(request: Request, session: SessionPayload, id: string) {
    const body = await readJson<{ project?: Record<string, unknown>; revision?: number }>(request, 8 * 1024 * 1024);
    if (!body.project || typeof body.project !== "object") throw new HttpError(400, "项目数据无效");
    const projects = (state.projects[session.userId] ||= {});
    const current = projects[id];
    if (current && Number(body.revision) !== current.revision) return json({ error: { message: "项目已在其他标签页更新", code: "REVISION_CONFLICT" }, current }, 409);
    const next = { project: body.project, revision: (current?.revision || 0) + 1, updatedAt: Date.now() };
    projects[id] = next;
    writeState();
    return json(next);
}

function deleteProject(session: SessionPayload, id: string) {
    const projects = state.projects[session.userId];
    if (projects) delete projects[id];
    writeState();
    return new Response(null, { status: 204 });
}

async function upstreamFetch(url: string, init: RequestInit, retryable: boolean) {
    const attempts = retryable || ["GET", "HEAD"].includes(init.method || "GET") ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
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

async function parseUpstreamJson(response: Response): Promise<any> {
    const text = await response.text();
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
    enforceRateLimit(`prompt:${clientIp(request)}`, 360);
    const target = promptProxyTarget(url.pathname, url.search);
    if (!target) throw new HttpError(404, "不支持的提示词资源地址");
    const cacheKey = createHash("sha256").update(target).digest("hex");
    const cachePath = join(PROMPT_CACHE_ROOT, cacheKey);
    const cached = Bun.file(cachePath);
    if (existsSync(cachePath) && Date.now() - cached.lastModified < 7 * 24 * 60 * 60 * 1000) {
        return new Response(cached, { headers: { "Content-Type": cached.type || "application/octet-stream", "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", "x-request-id": requestId } });
    }
    const response = await upstreamFetch(target, { headers: { "User-Agent": "InfiniteCanvas/1.0" } }, false);
    if (!response.ok) throw new HttpError(response.status, `提示词资源加载失败：${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength <= 20 * 1024 * 1024) await Bun.write(cachePath, bytes);
    return new Response(bytes, { headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream", "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", "x-request-id": requestId } });
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
    const status = error instanceof HttpError ? error.status : error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    const message = error instanceof Error ? error.message : "服务器内部错误";
    console.error(JSON.stringify({ event: "request_error", requestId, status, message, stack: error instanceof Error ? error.stack : undefined }));
    return json({ error: { message }, requestId }, status);
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
    return Response.json(value, { status, headers });
}

async function readJson<T>(request: Request, maxBytes = MAX_JSON_BYTES): Promise<T> {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > maxBytes) throw new HttpError(413, "请求内容过大");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "请求内容过大");
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
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
        return;
    }
    bucket.count += 1;
    if (bucket.count > limit) throw new HttpError(429, "请求过于频繁，请稍后再试");
}

function clientIp(request: Request) {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function ownedChannel(userId: string, id: string) {
    const channel = state.channels[channelKey(userId, id)];
    if (!channel) throw new HttpError(404, "渠道不存在或尚未保存 API Key");
    return channel;
}

function ownedJob(userId: string, id: string) {
    const job = imageQueue.get(id);
    if (!job || job.input.userId !== userId) throw new HttpError(404, "任务不存在");
    return job;
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

function loadState(): ServerState {
    if (existsSync(STATE_PATH)) {
        try {
            const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as ServerState;
            if (parsed.version === 1) {
                parsed.assets ||= {};
                parsed.projects ||= {};
                parsed.jobs ||= {};
                parsed.channels ||= {};
                parsed.users ||= {};
                return parsed;
            }
        } catch (error) {
            console.error(JSON.stringify({ event: "state_load_failed", message: error instanceof Error ? error.message : String(error) }));
        }
    }
    return { version: 1, auth: { accessCodeHash: "", sessionSecret: randomBytes(32).toString("base64url"), adminUserId: "" }, users: {}, channels: {}, assets: {}, jobs: {}, projects: {} };
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
    const temporary = `${STATE_PATH}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, STATE_PATH);
}

function summarizeJobs() {
    return imageQueue.list().reduce<Record<string, number>>((summary, job) => ({ ...summary, [job.status]: (summary[job.status] || 0) + 1 }), {});
}

function logRequest(request: Request, response: Response, requestId: string, durationMs: number) {
    const url = new URL(request.url);
    console.info(JSON.stringify({ event: "http_request", requestId, method: request.method, path: url.pathname, status: response.status, durationMs }));
}

function normalizeDisplayName(value: unknown) {
    const displayName = String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
    if (displayName.length < 2) throw new HttpError(400, "昵称至少 2 个字符");
    return displayName;
}

function normalizePersonalCode(value: unknown) {
    const personalCode = String(value || "").trim();
    if (personalCode.length < 6 || personalCode.length > 128) throw new HttpError(400, "个人密码需为 6 到 128 位");
    return personalCode;
}

function optionalString(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
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
    const parsed = parseDataUrl(value);
    if (!parsed.mimeType.startsWith("image/")) throw new HttpError(400, "参考图格式无效");
    if (Math.ceil((parsed.base64.length * 3) / 4) > 16 * 1024 * 1024) throw new HttpError(413, "单张参考图不能超过 16 MB");
}

function parseDataUrl(value: string) {
    const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=_-]+)$/);
    if (!match) throw new HttpError(400, "图片数据格式无效");
    return { mimeType: match[1].toLowerCase(), base64: match[2] };
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

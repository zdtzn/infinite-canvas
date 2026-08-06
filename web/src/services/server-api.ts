import { nanoid } from "nanoid";

import { friendlyErrorMessage } from "@/lib/friendly-error";
import type { Asset } from "@/stores/use-asset-store";
import type { ApiCallFormat, ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export type AuthUser = { userId: string; displayName: string; admin?: boolean; avatarUrl?: string };
export type AuthStatus = { configured: boolean; authenticated: boolean; user: AuthUser | null; publicMode: boolean };
export type ServerMember = AuthUser & { createdAt: number; disabled: boolean };
export type ServerAsset = { key: string; url: string; mimeType: string; bytes: number; createdAt: number };
export type ServerChannel = Omit<ModelChannel, "apiKey" | "credentialState"> & { hasApiKey: boolean };
export type ServerImageReferenceInput = string | { assetKey: string };
export type PromptOptimizerTarget = { channelId: string; model: string };
export type PromptOptimizerAdminConfiguration = {
    configured: PromptOptimizerTarget | null;
    effective: PromptOptimizerTarget | null;
    lockedByEnvironment: boolean;
};
export type ServerAssetLibrary = { initialized: boolean; items: Asset[] };
export type ServerJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type ServerJobImage = { id: string; dataUrl: string; bytes: number; durationMs: number; mimeType: string; width?: number; height?: number };
export type ServerJob = {
    id: string;
    status: ServerJobStatus;
    phase?: "queued" | "submitting" | "waiting_upstream" | "completed";
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    prompt: string;
    model: string;
    count: number;
    channelId?: string;
    quality?: string;
    imageQuality?: string;
    imageOutputFormat?: string;
    size?: string;
    background?: string;
    source?: { route?: string; projectId?: string; nodeId?: string; label?: string };
    result?: { images: ServerJobImage[]; successCount: number; failCount: number; durationMs: number };
};

export class ServerRequestError extends Error {
    readonly status: number;
    readonly requestId?: string;

    constructor(message: string, status: number, requestId?: string) {
        const shortRequestId = requestId?.trim().slice(0, 12);
        super(shortRequestId ? `${message}（请求编号 ${shortRequestId}）` : message);
        this.name = "ServerRequestError";
        this.status = status;
        this.requestId = requestId;
    }
}
export type CultivationBreakthrough = { id: string; fromStageName: string; toStageName: string; status: string };
export type CultivationProfile = {
    userId: string;
    displayName: string;
    avatarUrl?: string;
    realmId: string;
    realmName: string;
    stageId: string;
    stageName: string;
    stageOrder: number;
    color: string;
    iconKey: string;
    animationPreset: string;
    currentXp: number;
    totalXp: number;
    requiredXp: number;
    xpToNext: number;
    nextStageName: string | null;
    pendingStageId: string | null;
    dailyLimit: number | null;
    dailyLimitOverride: number | null;
    unlimited: boolean;
    usedToday: number;
    reservedToday: number;
    remainingToday: number | null;
    maxConcurrency: number;
    capabilities: string[];
    totalImages: number;
    activeDays: number;
    publicMessage: string;
    internalNote?: string;
    breakthrough: CultivationBreakthrough | null;
};
export type CultivationStageConfig = { id: string; name: string; order: number; requiredXp: number; active: boolean; capabilities: string[] };
export type CultivationRealmConfig = {
    id: string;
    code: string;
    name: string;
    color: string;
    iconKey: string;
    animationPreset: string;
    sortOrder: number;
    dailyLimit: number | null;
    maxConcurrency: number;
    promotionPolicy: "auto" | "manual" | "boundary_manual";
    active: boolean;
    stages: CultivationStageConfig[];
};
export type CultivationConfiguration = { realms: CultivationRealmConfig[]; capabilities: Array<{ key: string; label: string; category: string; active: boolean }>; rewards: Record<string, number> };
export type PagedResponse<T> = { items: T[]; page: number; pageSize: number; total: number };
export type AdminChannelMetric = {
    userId: string;
    ownerName: string;
    channelId: string;
    channelName: string;
    host: string;
    protocol: ApiCallFormat;
    status: "idle" | "active" | "healthy" | "degraded" | "unavailable";
    successRate: number | null;
    totalJobs: number;
    activeJobs: number;
    requestedImages: number;
    successImages: number;
    failedImages: number;
    avgDurationMs: number;
    lastUsedAt: number;
    lastError: string;
};
export type AdminMetrics = {
    users: number;
    channels: number;
    jobs: Partial<Record<ServerJobStatus, number>>;
    uptimeSeconds: number;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
    backup: {
        enabled: boolean;
        directory: string;
        retentionCount: number;
        intervalHours: number;
        lastAttemptAt?: number;
        lastCompletedAt?: number;
        lastFilename?: string;
        lastBytes?: number;
        lastError?: string;
        nextRunAt?: number;
    } | null;
    assetGc: {
        enabled: boolean;
        graceMs: number;
        intervalHours: number;
        running: boolean;
        lastAttemptAt?: number;
        lastCompletedAt?: number;
        lastRemovedAssets: number;
        lastRemovedFiles: number;
        lastFreedBytes: number;
        lastError?: string;
    };
};

export async function fetchAuthStatus() {
    return serverRequest<AuthStatus>("/api/auth/status", { timeoutMs: 12_000 });
}

export async function setupAccess(input: { accessCode: string; displayName: string; personalCode: string }) {
    return serverRequest<{ authenticated: true; user: AuthUser }>("/api/auth/setup", { method: "POST", body: input });
}

export async function loginAccess(input: { accessCode: string; displayName: string; personalCode: string }) {
    return serverRequest<{ authenticated: true; user: AuthUser }>("/api/auth/login", { method: "POST", body: input });
}

export async function logoutAccess() {
    await serverRequest("/api/auth/logout", { method: "POST" });
}

export async function fetchServerChannels() {
    return serverRequest<{ items: ServerChannel[] }>("/api/channels", { timeoutMs: 12_000 });
}

export async function saveServerChannel(channel: ModelChannel) {
    return serverRequest(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: "PUT",
        body: {
            name: channel.name,
            baseUrl: channel.baseUrl,
            apiFormat: channel.apiFormat,
            apiKey: channel.apiKey,
            models: channel.models.map(({ name, capability, imageCapabilities }) => ({ name, capability, ...(imageCapabilities ? { imageCapabilities } : {}) })),
            sortOrder: channel.sortOrder,
        },
    });
}

export async function testServerChannel(channel: ModelChannel) {
    return serverRequest<{ ok: true; modelCount: number; models: string[] }>(`/api/channels/${encodeURIComponent(channel.id)}/test`, {
        method: "POST",
        body: {
            baseUrl: channel.baseUrl,
            apiFormat: channel.apiFormat,
            apiKey: channel.apiKey,
        },
        timeoutMs: 30_000,
    });
}

export async function reorderServerChannels(channelIds: string[]) {
    await serverRequest("/api/channels/order", { method: "PUT", body: { channelIds } });
}

export async function deleteServerChannel(channelId: string) {
    await serverRequest(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
}

export async function fetchPromptOptimizerAdminConfiguration() {
    return serverRequest<PromptOptimizerAdminConfiguration>("/api/admin/prompt-optimizer", { timeoutMs: 12_000 });
}

export async function updatePromptOptimizerAdminConfiguration(target: PromptOptimizerTarget | null) {
    return serverRequest<PromptOptimizerAdminConfiguration>("/api/admin/prompt-optimizer", {
        method: "PUT",
        body: target || { channelId: "", model: "" },
    });
}

export async function uploadServerAsset(blob: Blob, prefix: string, storageKey?: string, expectedUserId?: string) {
    const form = new FormData();
    form.set("file", blob, `asset.${mimeExtension(blob.type)}`);
    form.set("prefix", prefix);
    if (storageKey) form.set("storageKey", storageKey);
    const response = await fetch("/api/assets", { method: "POST", body: form, headers: expectedUserHeaders(undefined, expectedUserId), credentials: "same-origin" });
    return readJsonResponse<{ asset: ServerAsset }>(response);
}

export async function promoteServerJobAsset(sourceUrl: string, expectedUserId?: string) {
    return serverRequest<{ asset: ServerAsset; sourceUrl: string; width?: number; height?: number }>("/api/assets/from-job", {
        method: "POST",
        body: { sourceUrl },
        expectedUserId,
    });
}

export async function fetchServerAssetBlob(storageKey: string, expectedUserId?: string) {
    const response = await fetch(`/api/assets/${encodeURIComponent(storageKey)}`, { headers: expectedUserHeaders(undefined, expectedUserId), credentials: "same-origin" });
    if (!response.ok) await throwResponseError(response);
    return response.blob();
}

export async function deleteServerAsset(storageKey: string, expectedUserId?: string) {
    await serverRequest(`/api/assets/${encodeURIComponent(storageKey)}`, { method: "DELETE", expectedUserId });
}

export async function fetchServerAssetLibrary(expectedUserId?: string) {
    return serverRequest<ServerAssetLibrary>("/api/library-assets", { timeoutMs: 20_000, expectedUserId });
}

export async function replaceServerAssetLibrary(items: Asset[], initializeOnly = false, expectedUserId?: string) {
    return serverRequest<ServerAssetLibrary>("/api/library-assets", { method: "PUT", body: { items, initializeOnly }, timeoutMs: 30_000, expectedUserId });
}

export async function upsertServerAssetLibraryItem(item: Asset, expectedUserId?: string) {
    return serverRequest<{ item: Asset }>(`/api/library-assets/${encodeURIComponent(item.id)}`, { method: "PUT", body: { item }, expectedUserId });
}

export async function deleteServerAssetLibraryItem(id: string, expectedUserId?: string) {
    await serverRequest(`/api/library-assets/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export async function fetchServerGenerationHistory(kind: "image" | "video", expectedUserId?: string) {
    return serverRequest<{ items: Record<string, unknown>[] }>(`/api/generation-history/${kind}`, { timeoutMs: 20_000, expectedUserId });
}

export async function mergeServerGenerationHistory(kind: "image" | "video", items: Record<string, unknown>[], expectedUserId?: string) {
    return serverRequest<{ items: Record<string, unknown>[] }>(`/api/generation-history/${kind}`, { method: "PUT", body: { items }, timeoutMs: 30_000, expectedUserId });
}

export async function upsertServerGenerationHistoryItem(kind: "image" | "video", item: Record<string, unknown>, expectedUserId?: string) {
    const id = String(item.id || "");
    return serverRequest<{ item: Record<string, unknown> }>(`/api/generation-history/${kind}/${encodeURIComponent(id)}`, { method: "PUT", body: { item }, expectedUserId });
}

export async function deleteServerGenerationHistoryItems(kind: "image" | "video", ids: string[], jobIds: string[] = [], expectedUserId?: string) {
    return serverRequest<{ deleted: number; removedJobs: number }>(`/api/generation-history/${kind}`, {
        method: "DELETE",
        body: { ids, jobIds },
        timeoutMs: 30_000,
        expectedUserId,
    });
}

export async function uploadProfileAvatar(file: File) {
    const form = new FormData();
    form.set("file", file, file.name || `avatar.${mimeExtension(file.type)}`);
    const response = await fetch("/api/profile/avatar", { method: "POST", body: form, headers: expectedUserHeaders(), credentials: "same-origin" });
    return readJsonResponse<{ asset: ServerAsset; avatarUrl: string }>(response);
}

export async function deleteProfileAvatar() {
    return serverRequest<{ avatarUrl: string }>("/api/profile/avatar", { method: "DELETE" });
}

export async function submitImageJob(input: {
    channelId: string;
    apiFormat: ApiCallFormat;
    model: string;
    prompt: string;
    count: number;
    quality?: string;
    imageQuality?: string;
    imageOutputFormat?: string;
    size?: string;
    background?: string;
    references: ServerImageReferenceInput[];
    mask?: ServerImageReferenceInput;
    source?: ServerJob["source"];
}, expectedUserId?: string, idempotencyKey = nanoid()) {
    return serverRequest<{ job: ServerJob }>("/api/jobs/images", { method: "POST", body: input, headers: { "Idempotency-Key": idempotencyKey }, timeoutMs: 60_000, expectedUserId });
}

export async function fetchServerJobs(expectedUserId?: string) {
    return serverRequest<{ items: ServerJob[] }>("/api/jobs", { timeoutMs: 12_000, expectedUserId });
}

export async function fetchServerJob(id: string, expectedUserId?: string) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}`, { timeoutMs: 12_000, expectedUserId });
}

export async function cancelServerJob(id: string, expectedUserId?: string) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export async function removeServerJob(id: string, expectedUserId?: string) {
    await serverRequest(`/api/jobs/${encodeURIComponent(id)}?remove=1`, { method: "DELETE", expectedUserId });
}

export async function retryServerJob(id: string, expectedUserId?: string, idempotencyKey = nanoid()) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, expectedUserId });
}

export async function fetchCultivationProfile() {
    return serverRequest<{ profile: CultivationProfile }>("/api/cultivation/me", { timeoutMs: 12_000 });
}

export async function markCultivationBreakthroughSeen(id: string) {
    await serverRequest(`/api/cultivation/breakthroughs/${encodeURIComponent(id)}/seen`, { method: "POST" });
}

export async function fetchAdminCultivationUsers(page = 1, pageSize = 20, search = "") {
    return serverRequest<PagedResponse<CultivationProfile & { status: string }>>(`/api/admin/cultivation/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`);
}

export async function updateAdminCultivationUser(userId: string, input: Record<string, unknown>) {
    return serverRequest<{ profile: CultivationProfile }>(`/api/admin/cultivation/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: input });
}

export async function fetchCultivationConfiguration() {
    return serverRequest<CultivationConfiguration>("/api/admin/cultivation/config");
}

export async function updateCultivationRealm(realmId: string, input: Record<string, unknown>) {
    return serverRequest<CultivationConfiguration>(`/api/admin/cultivation/realms/${encodeURIComponent(realmId)}`, { method: "PATCH", body: input });
}

export async function updateCultivationStage(stageId: string, input: Record<string, unknown>) {
    return serverRequest<CultivationConfiguration>(`/api/admin/cultivation/stages/${encodeURIComponent(stageId)}`, { method: "PATCH", body: input });
}

export async function updateCultivationCapability(capabilityKey: string, input: Record<string, unknown>) {
    return serverRequest<CultivationConfiguration>(`/api/admin/cultivation/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "PATCH", body: input });
}

export async function updateCultivationRewards(rewards: Record<string, number>, reason: string) {
    return serverRequest<CultivationConfiguration>("/api/admin/cultivation/rewards", { method: "PATCH", body: { rewards, reason } });
}

export async function fetchCultivationLog<T>(kind: "ledger" | "usage" | "audit-logs" | "login-logs" | "breakthroughs", page = 1, pageSize = 20, userId = "") {
    const user = userId ? `&userId=${encodeURIComponent(userId)}` : "";
    return serverRequest<PagedResponse<T>>(`/api/admin/cultivation/${kind}?page=${page}&pageSize=${pageSize}${user}`);
}

export async function waitForServerJob(id: string, options?: { signal?: AbortSignal; onUpdate?: (job: ServerJob) => void; expectedUserId?: string }) {
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { job } = await fetchServerJob(id, options?.expectedUserId);
        options?.onUpdate?.(job);
        if (job.status === "succeeded") return job;
        if (job.status === "failed") throw new Error(`${friendlyErrorMessage(job.error || "生成失败")}（任务编号 ${job.id.slice(0, 12)}）`);
        if (job.status === "canceled") throw new DOMException("Aborted", "AbortError");
        await abortableSleep(job.status === "queued" ? 1200 : 1800, options?.signal);
    }
}

export async function saveServerProject(project: Record<string, unknown>, revision: number, expectedUserId?: string) {
    const id = String(project.id || "");
    return serverRequest<{ project: Record<string, unknown>; revision: number; updatedAt: number }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PUT", body: { project, revision }, timeoutMs: 20_000, expectedUserId });
}

export async function fetchServerProjects(expectedUserId?: string) {
    return serverRequest<{ items: Array<{ project: Record<string, unknown>; revision: number; updatedAt: number }>; deleted: Array<{ projectId: string; revision: number; deletedAt: number }> }>("/api/projects", { timeoutMs: 20_000, expectedUserId });
}

export async function deleteServerProject(projectId: string, revision: number, expectedUserId?: string) {
    await serverRequest(`/api/projects/${encodeURIComponent(projectId)}?revision=${encodeURIComponent(String(revision))}`, { method: "DELETE", expectedUserId });
}

export async function fetchServerMembers() {
    return serverRequest<{ items: ServerMember[] }>("/api/admin/users", { timeoutMs: 12_000 });
}

export async function updateServerMember(userId: string, disabled: boolean) {
    return serverRequest<{ user: ServerMember }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { disabled } });
}

type ServerRequestOptions = Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number; expectedUserId?: string };

export async function serverRequest<T = unknown>(url: string, options: ServerRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), options.timeoutMs || 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const headers = expectedUserHeaders(options.headers, options.expectedUserId);
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
    }
    const { body: _body, timeoutMs: _timeoutMs, expectedUserId: _expectedUserId, ...requestOptions } = options;
    try {
        const response = await fetch(url, { ...requestOptions, headers, body, signal, credentials: "same-origin" });
        if (response.status === 204) return undefined as T;
        return readJsonResponse<T>(response);
    } catch (error) {
        if (error instanceof ServerRequestError) throw error;
        if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("请求超时，请检查网络或上游接口状态");
        if (error instanceof DOMException && error.name === "AbortError" && options.signal?.aborted) throw error;
        throw new Error(friendlyErrorMessage(error));
    } finally {
        window.clearTimeout(timeout);
    }
}

function expectedUserHeaders(headers?: HeadersInit, expectedUserId?: string) {
    const result = new Headers(headers);
    const userId = expectedUserId === undefined ? useUserStore.getState().user?.id || "" : expectedUserId.trim();
    if (userId) result.set("X-Expected-User-Id", userId);
    return result;
}

export function fetchServerResource(input: RequestInfo | URL, init: RequestInit = {}, expectedUserId?: string) {
    const target = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const sameOrigin = typeof window === "undefined" || new URL(target, window.location.href).origin === window.location.origin;
    return fetch(input, {
        ...init,
        headers: sameOrigin ? expectedUserHeaders(init.headers, expectedUserId) : init.headers,
        credentials: "same-origin",
    });
}

async function readJsonResponse<T>(response: Response) {
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    if (!response.ok) throwResponsePayload(response.status, payload, response.headers.get("x-request-id") || undefined);
    return payload as T;
}

async function throwResponseError(response: Response): Promise<never> {
    const text = await response.text();
    throwResponsePayload(response.status, text ? safeJson(text) : {}, response.headers.get("x-request-id") || undefined);
}

function throwResponsePayload(status: number, payload: unknown, headerRequestId?: string): never {
    const originalMessage = readServerError(payload);
    const message = friendlyErrorMessage(originalMessage, status);
    if (status === 401 || (status === 403 && message.includes("账号已停用"))) window.dispatchEvent(new Event("canvas:auth-invalid"));
    throw new ServerRequestError(message, status, readServerRequestId(payload) || headerRequestId);
}

export async function fetchAdminChannelMetrics(days = 7) {
    return serverRequest<{ days: number; items: AdminChannelMetric[] }>(`/api/admin/channels/metrics?days=${Math.max(1, Math.min(30, Math.floor(days)))}`);
}

export async function fetchAdminMetrics() {
    return serverRequest<AdminMetrics>("/api/admin/metrics");
}

function mimeExtension(mimeType: string) {
    return ({ "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" } as Record<string, string>)[mimeType] || "bin";
}

function safeJson(text: string) {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function readServerError(value: unknown) {
    if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 300) : "";
    const record = value as { error?: { message?: string }; message?: string };
    return record.error?.message || record.message || "";
}

function readServerRequestId(value: unknown) {
    if (!value || typeof value !== "object") return "";
    return String((value as { requestId?: unknown }).requestId || "").trim();
}

function abortableSleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

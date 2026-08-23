import { nanoid } from "nanoid";

import { friendlyErrorMessage } from "@/lib/friendly-error";
import type { Asset } from "@/stores/use-asset-store";
import type { ApiCallFormat, ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

export type AuthUser = { userId: string; displayName: string; admin?: boolean; avatarUrl?: string };
export type AuthStatus = { configured: boolean; authenticated: boolean; user: AuthUser | null; publicMode: boolean };
export type ServerMember = AuthUser & { createdAt: number; disabled: boolean };
export type ServerAsset = { key: string; url: string; mimeType: string; bytes: number; createdAt: number };
export type ServerChannel = Omit<ModelChannel, "apiKey" | "credentialState"> & { hasApiKey: boolean };
export type ServerPromptSource = Omit<PromptSource, "trusted"> & { trusted: true };
export type ServerImageReferenceInput = string | { assetKey: string };
export type PromptOptimizerTarget = { channelId: string; model: string };
export type PromptOptimizerAdminConfiguration = {
    configured: PromptOptimizerTarget | null;
    effective: PromptOptimizerTarget | null;
    lockedByEnvironment: boolean;
};
export type ServerAssetLibrary = { initialized: boolean; items: Asset[]; page?: number; pageSize?: number; total?: number; hasMore?: boolean };
export type ServerJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type ServerJobImage = { id: string; dataUrl: string; bytes: number; durationMs: number; mimeType: string; width?: number; height?: number; persisted?: boolean; expiresAt?: string; recoveryUrl?: string };
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
    result?: { images: ServerJobImage[]; successCount: number; failCount: number; durationMs: number; recoveryPending?: boolean };
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

export async function revokeAllServerSessions() {
    return serverRequest<{ ok: true }>("/api/auth/sessions/revoke", { method: "POST" });
}

export async function changePersonalPassword(currentPassword: string, newPassword: string) {
    return serverRequest<{ authenticated: true; user: AuthUser }>("/api/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
    });
}

export async function downloadAccountExport(expectedUserId?: string) {
    const response = await fetch("/api/account/export", { headers: expectedUserHeaders(undefined, expectedUserId), credentials: "same-origin" });
    if (!response.ok) await throwResponseError(response);
    return response.blob();
}

export type ServerUserPreferences = {
    systemPrompt: string;
    systemPromptConfigured?: boolean;
    chatPresetId: string;
    chatPresetConfigured?: boolean;
    chatPersona: string;
    chatPersonaConfigured?: boolean;
};

export async function fetchServerUserPreferences(expectedUserId?: string) {
    return serverRequest<ServerUserPreferences>("/api/preferences", { timeoutMs: 12_000, expectedUserId });
}

export async function saveServerUserPreferences(preferences: Partial<ServerUserPreferences>, expectedUserId?: string) {
    return serverRequest<ServerUserPreferences>("/api/preferences", { method: "PUT", body: preferences, timeoutMs: 12_000, expectedUserId });
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

export async function fetchServerPromptSources() {
    return serverRequest<{ items: ServerPromptSource[] }>("/api/prompt-sources", { timeoutMs: 12_000 });
}

export async function saveServerPromptSource(source: PromptSource) {
    return serverRequest<{ ok: true; source: ServerPromptSource }>(`/api/admin/prompt-sources/${encodeURIComponent(source.id)}`, {
        method: "PUT",
        body: {
            id: source.id,
            name: source.name,
            githubUrl: source.githubUrl,
            enabled: source.enabled,
            script: source.script,
        },
    });
}

export async function deleteServerPromptSource(sourceId: string) {
    await serverRequest(`/api/admin/prompt-sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
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

export async function fetchServerAssetLibrary(expectedUserId?: string, options: { page?: number; pageSize?: number; keyword?: string; kind?: string; tag?: string } = {}) {
    const params = new URLSearchParams();
    if (options.page) params.set("page", String(options.page));
    if (options.pageSize) params.set("pageSize", String(options.pageSize));
    if (options.keyword) params.set("keyword", options.keyword);
    if (options.kind) params.set("kind", options.kind);
    if (options.tag) params.set("tag", options.tag);
    const query = params.toString();
    return serverRequest<ServerAssetLibrary>(`/api/library-assets${query ? `?${query}` : ""}`, { timeoutMs: 20_000, expectedUserId });
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

export async function fetchServerGenerationHistory(kind: "image" | "video", expectedUserId?: string, options: { page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (options.page) params.set("page", String(options.page));
    if (options.pageSize) params.set("pageSize", String(options.pageSize));
    const query = params.toString();
    return serverRequest<{ items: Record<string, unknown>[]; page?: number; pageSize?: number; total?: number; hasMore?: boolean }>(`/api/generation-history/${kind}${query ? `?${query}` : ""}`, { timeoutMs: 20_000, expectedUserId });
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

export async function recoverServerJobResult(id: string, expectedUserId?: string) {
    const current = await serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}`, { timeoutMs: 12_000, expectedUserId });
    const before = current.job.result?.images.filter((image) => image.persisted === false).length || 0;
    if (before && current.job.result?.images.some((image) => image.recoveryUrl)) {
        const job = await archiveDeferredServerJob(current.job, expectedUserId);
        const remaining = job.result?.images.filter((image) => image.persisted === false).length || 0;
        return { job, recovered: Math.max(0, before - remaining), recoveryPending: remaining > 0 };
    }
    return serverRequest<{ job: ServerJob; recovered: number; recoveryPending: boolean; lastError?: string }>(`/api/jobs/${encodeURIComponent(id)}/recover`, {
        method: "POST",
        timeoutMs: 30_000,
        expectedUserId,
    });
}

const serverJobArchiveRuns = new Map<string, Promise<{ job: ServerJob; image: ServerJobImage; archived: boolean }>>();
const SERVER_JOB_ARCHIVE_RETRY_DELAYS_MS = [1_200, 3_000];

export async function archiveDeferredServerJob(job: ServerJob, expectedUserId?: string, signal?: AbortSignal) {
    let current = job;
    const images = current.result?.images || [];
    for (const source of images) {
        for (let attempt = 0; attempt <= SERVER_JOB_ARCHIVE_RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                if (attempt) current = (await fetchServerJob(current.id, expectedUserId)).job;
                const image = current.result?.images.find((candidate) => candidate.id === source.id) || source;
                if (image.persisted !== false) break;
                if (!image.recoveryUrl) throw new Error("图片没有可用的自动保存地址");
                current = (await archiveServerJobImage(current.id, image, expectedUserId, signal)).job;
                break;
            } catch (error) {
                if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
                const delay = SERVER_JOB_ARCHIVE_RETRY_DELAYS_MS[attempt];
                if (delay === undefined) throw error;
                await abortableSleep(delay, signal);
            }
        }
    }
    return current;
}

export function archiveServerJobImage(jobId: string, image: ServerJobImage, expectedUserId?: string, signal?: AbortSignal) {
    if (image.persisted !== false || !image.recoveryUrl) throw new Error("图片没有可用的归档地址");
    const key = `${jobId}:${image.id}`;
    const existing = serverJobArchiveRuns.get(key);
    if (existing) return existing;
    const pending = performServerJobImageArchive(jobId, image, expectedUserId, signal).finally(() => {
        if (serverJobArchiveRuns.get(key) === pending) serverJobArchiveRuns.delete(key);
    });
    serverJobArchiveRuns.set(key, pending);
    return pending;
}

async function performServerJobImageArchive(jobId: string, image: ServerJobImage, expectedUserId?: string, signal?: AbortSignal) {
    const relayController = new AbortController();
    const timeout = window.setTimeout(() => relayController.abort(new DOMException("Timeout", "TimeoutError")), 45_000);
    const relaySignal = signal ? AbortSignal.any([signal, relayController.signal]) : relayController.signal;
    let blob: Blob;
    try {
        const response = await fetch(image.recoveryUrl!, { signal: relaySignal, credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error(`图片中转返回 ${response.status}`);
        blob = await response.blob();
    } finally {
        window.clearTimeout(timeout);
    }
    if (!blob.size || blob.size > 32 * 1024 * 1024 || !blob.type.startsWith("image/")) throw new Error("图片中转没有返回有效图片");
    const form = new FormData();
    form.set("imageId", image.id);
    form.set("file", blob, `result.${imageFileExtension(blob.type)}`);
    return serverRequest<{ job: ServerJob; image: ServerJobImage; archived: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}/archive`, {
        method: "POST",
        body: form,
        timeoutMs: 60_000,
        expectedUserId,
        signal,
    });
}

function imageFileExtension(mimeType: string) {
    return ({ "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[mimeType.toLowerCase()] || "png";
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
        if (job.status === "succeeded") {
            void archiveDeferredServerJob(job, options?.expectedUserId).catch(() => undefined);
            return job;
        }
        if (job.status === "failed") throw new Error(`${friendlyErrorMessage(job.error || "生成失败")}（任务编号 ${job.id.slice(0, 12)}）`);
        if (job.status === "canceled") throw new DOMException("Aborted", "AbortError");
        await abortableSleep(job.status === "queued" ? 1200 : 1800, options?.signal);
    }
}

export async function saveServerProject(project: Record<string, unknown>, revision: number, expectedUserId?: string) {
    const id = String(project.id || "");
    return serverRequest<{ project: Record<string, unknown>; revision: number; updatedAt: number }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PUT", body: { project, revision }, timeoutMs: 20_000, expectedUserId });
}

export async function branchServerProject(projectId: string, project?: Record<string, unknown>, revision = 0, expectedUserId?: string) {
    return serverRequest<{ project: Record<string, unknown>; revision: number; updatedAt: number }>(`/api/projects/${encodeURIComponent(projectId)}/branch`, {
        method: "POST",
        body: project ? { project, revision } : undefined,
        timeoutMs: 30_000,
        expectedUserId,
    });
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
        if (options.body instanceof FormData) {
            body = options.body;
        } else {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }
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

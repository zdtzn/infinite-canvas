import { nanoid } from "nanoid";

import type { ApiCallFormat, ModelChannel } from "@/stores/use-config-store";

export type AuthUser = { userId: string; displayName: string; admin?: boolean; avatarUrl?: string };
export type AuthStatus = { configured: boolean; authenticated: boolean; user: AuthUser | null; publicMode: boolean };
export type ServerMember = AuthUser & { createdAt: number; disabled: boolean };
export type ServerAsset = { key: string; url: string; mimeType: string; bytes: number; createdAt: number };
export type ServerJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type ServerJobImage = { id: string; dataUrl: string; bytes: number; durationMs: number; mimeType: string };
export type ServerJob = {
    id: string;
    status: ServerJobStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    prompt: string;
    model: string;
    count: number;
    source?: { route?: string; projectId?: string; nodeId?: string; label?: string };
    result?: { images: ServerJobImage[]; successCount: number; failCount: number; durationMs: number };
};
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

export async function saveServerChannel(channel: ModelChannel) {
    return serverRequest(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: "PUT",
        body: { name: channel.name, baseUrl: channel.baseUrl, apiFormat: channel.apiFormat, apiKey: channel.apiKey },
    });
}

export async function deleteServerChannel(channelId: string) {
    await serverRequest(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
}

export async function uploadServerAsset(blob: Blob, prefix: string, storageKey?: string) {
    const form = new FormData();
    form.set("file", blob, `asset.${mimeExtension(blob.type)}`);
    form.set("prefix", prefix);
    if (storageKey) form.set("storageKey", storageKey);
    const response = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin" });
    return readJsonResponse<{ asset: ServerAsset }>(response);
}

export async function fetchServerAssetBlob(storageKey: string) {
    const response = await fetch(`/api/assets/${encodeURIComponent(storageKey)}`, { credentials: "same-origin" });
    if (!response.ok) await throwResponseError(response);
    return response.blob();
}

export async function deleteServerAsset(storageKey: string) {
    await serverRequest(`/api/assets/${encodeURIComponent(storageKey)}`, { method: "DELETE" });
}

export async function uploadProfileAvatar(file: File) {
    const form = new FormData();
    form.set("file", file, file.name || `avatar.${mimeExtension(file.type)}`);
    const response = await fetch("/api/profile/avatar", { method: "POST", body: form, credentials: "same-origin" });
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
    references: string[];
    mask?: string;
    source?: ServerJob["source"];
}) {
    return serverRequest<{ job: ServerJob }>("/api/jobs/images", { method: "POST", body: input, headers: { "Idempotency-Key": nanoid() }, timeoutMs: 60_000 });
}

export async function fetchServerJobs() {
    return serverRequest<{ items: ServerJob[] }>("/api/jobs", { timeoutMs: 12_000 });
}

export async function fetchServerJob(id: string) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}`, { timeoutMs: 12_000 });
}

export async function cancelServerJob(id: string) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function removeServerJob(id: string) {
    await serverRequest(`/api/jobs/${encodeURIComponent(id)}?remove=1`, { method: "DELETE" });
}

export async function retryServerJob(id: string) {
    return serverRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
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

export async function approveAdminBreakthrough(userId: string, reason: string) {
    return serverRequest<{ profile: CultivationProfile }>(`/api/admin/cultivation/users/${encodeURIComponent(userId)}/approve`, { method: "POST", body: { reason } });
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

export async function waitForServerJob(id: string, options?: { signal?: AbortSignal; onUpdate?: (job: ServerJob) => void }) {
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { job } = await fetchServerJob(id);
        options?.onUpdate?.(job);
        if (job.status === "succeeded") return job;
        if (job.status === "failed") throw new Error(job.error || "生成失败");
        if (job.status === "canceled") throw new DOMException("Aborted", "AbortError");
        await abortableSleep(job.status === "queued" ? 1200 : 1800, options?.signal);
    }
}

export async function saveServerProject(project: Record<string, unknown>, revision: number) {
    const id = String(project.id || "");
    return serverRequest<{ project: Record<string, unknown>; revision: number; updatedAt: number }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PUT", body: { project, revision }, timeoutMs: 20_000 });
}

export async function fetchServerProjects() {
    return serverRequest<{ items: Array<{ project: Record<string, unknown>; revision: number; updatedAt: number }>; deleted: Array<{ projectId: string; revision: number; deletedAt: number }> }>("/api/projects", { timeoutMs: 20_000 });
}

export async function deleteServerProject(projectId: string, revision: number) {
    await serverRequest(`/api/projects/${encodeURIComponent(projectId)}?revision=${encodeURIComponent(String(revision))}`, { method: "DELETE" });
}

export async function fetchServerMembers() {
    return serverRequest<{ items: ServerMember[] }>("/api/admin/users", { timeoutMs: 12_000 });
}

export async function updateServerMember(userId: string, disabled: boolean) {
    return serverRequest<{ user: ServerMember }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { disabled } });
}

type ServerRequestOptions = Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number };

export async function serverRequest<T = unknown>(url: string, options: ServerRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), options.timeoutMs || 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const headers = new Headers(options.headers);
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
    }
    try {
        const response = await fetch(url, { ...options, headers, body, signal, credentials: "same-origin" });
        if (response.status === 204) return undefined as T;
        return readJsonResponse<T>(response);
    } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("请求超时，请检查网络或上游接口状态");
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}

async function readJsonResponse<T>(response: Response) {
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    if (!response.ok) throwResponsePayload(response.status, payload);
    return payload as T;
}

async function throwResponseError(response: Response): Promise<never> {
    const text = await response.text();
    throwResponsePayload(response.status, text ? safeJson(text) : {});
}

function throwResponsePayload(status: number, payload: unknown): never {
    const message = readServerError(payload) || `请求失败：${status}`;
    if (status === 401 || (status === 403 && message.includes("账号已停用"))) window.dispatchEvent(new Event("canvas:auth-invalid"));
    throw new Error(message);
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

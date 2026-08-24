import { PUBLIC_MODE } from "@/constant/runtime-config";
import { runWithConcurrency } from "@/lib/async-pool";
import { deleteServerGenerationHistoryItems, fetchServerGenerationHistory, mergeServerGenerationHistory, upsertServerGenerationHistoryItem } from "@/services/server-api";

export type GenerationHistoryKind = "image" | "video";

export type GenerationHistoryRecord = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    deletedAt?: number;
    ownerUserId?: string;
};

type HistoryStore = {
    getItem<T>(key: string): Promise<T | null>;
    iterate<T, U>(iteratorCallback: (value: T, key: string, iterationNumber: number) => U): Promise<U>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
};

type HistorySyncOptions<T extends GenerationHistoryRecord> = {
    kind: GenerationHistoryKind;
    userId: string;
    store: HistoryStore;
    hydrate: (record: T) => Promise<T>;
    prepare: (record: T, expectedUserId: string) => Promise<T>;
};

const historyOperations = new Map<string, Promise<unknown>>();
const HISTORY_PREPARE_CONCURRENCY = 4;
const HISTORY_UPLOAD_BATCH_ITEMS = 50;
const HISTORY_UPLOAD_BATCH_BYTES = 6 * 1024 * 1024;
const HISTORY_MIGRATION_VERSION = 2;

export type GenerationHistoryPageQuery = {
    page: number;
    pageSize: number;
    search?: string;
    model?: string;
    status?: "success" | "failure";
};

export type GenerationHistoryPage<T> = {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    models: string[];
};

export function synchronizeGenerationHistory<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>) {
    return serializeHistoryOperation(options, () => synchronizeNow(options));
}

export async function loadGenerationHistoryPage<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>, query: GenerationHistoryPageQuery): Promise<GenerationHistoryPage<T>> {
    const pageSize = Math.max(1, Math.min(60, Math.floor(query.pageSize) || 18));
    const requestedPage = Math.max(1, Math.floor(query.page) || 1);
    const search = String(query.search || "")
        .trim()
        .slice(0, 200);
    const model = String(query.model || "")
        .trim()
        .slice(0, 300);
    const status = query.status === "success" || query.status === "failure" ? query.status : undefined;

    if (PUBLIC_MODE && options.userId) {
        const response = await fetchServerGenerationHistory(options.kind, options.userId, {
            page: requestedPage,
            pageSize,
            search,
            model,
            status,
            activeOnly: true,
        });
        const records = activeGenerationHistoryRecords((response.items as T[]).map((record) => withLocalOwnership(record, options.userId)));
        await Promise.all(records.map((record) => options.store.setItem(generationHistoryCacheKey(options.userId, record.id), record)));
        return {
            items: await Promise.all(records.map(options.hydrate)),
            page: Math.max(1, Number(response.page || requestedPage)),
            pageSize: Math.max(1, Number(response.pageSize || pageSize)),
            total: Math.max(0, Number(response.total || 0)),
            hasMore: Boolean(response.hasMore),
            models: normalizeHistoryModels(response.models),
        };
    }

    const local = activeGenerationHistoryRecords(await readOwnedHistoryCache<T>(options.store, options.userId));
    const filtered = filterGenerationHistoryRecords(local, { search, model, status });
    const total = filtered.length;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const offset = (page - 1) * pageSize;
    return {
        items: await Promise.all(filtered.slice(offset, offset + pageSize).map(options.hydrate)),
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
        models: normalizeHistoryModels(local.map(generationHistoryModel)),
    };
}

export function migrateLocalGenerationHistoryOnce<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>) {
    return serializeHistoryOperation(options, async () => {
        if (!PUBLIC_MODE || !options.userId) return false;
        const markerKey = generationHistoryMigrationKey(options.kind, options.userId);
        if (await options.store.getItem<boolean>(markerKey)) return false;
        const local = activeGenerationHistoryRecords(await readOwnedHistoryCache<T>(options.store, options.userId));
        if (local.length) {
            const { prepared, failed } = await prepareHistoryRecords(local, options.prepare, options.userId);
            if (failed.length) return false;
            try {
                await mergeServerGenerationHistoryBatches(options.kind, prepared, options.userId);
            } catch (error) {
                reportHistorySyncError(error);
                return false;
            }
        }
        await options.store.setItem(markerKey, true);
        return local.length > 0;
    });
}

export function persistGenerationHistoryRecord<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>, record: T) {
    return serializeHistoryOperation(options, async () => {
        const local = withLocalOwnership(record, options.userId);
        await options.store.setItem(generationHistoryCacheKey(options.userId, local.id), local);
        if (!PUBLIC_MODE || !options.userId) return options.hydrate(local);
        try {
            const prepared = stripLocalOwnership(await options.prepare(local, options.userId));
            const response = await upsertServerGenerationHistoryItem(options.kind, prepared as Record<string, unknown>, options.userId);
            const canonical = withLocalOwnership(response.item as T, options.userId);
            if (isGenerationHistoryTombstone(canonical)) {
                await Promise.all([options.store.removeItem(generationHistoryCacheKey(options.userId, local.id)), removeLegacyCacheItem(options.store, options.userId, local.id)]);
                return undefined;
            }
            await options.store.setItem(generationHistoryCacheKey(options.userId, canonical.id), canonical);
            return options.hydrate(canonical);
        } catch (error) {
            reportHistorySyncError(error);
            return options.hydrate(local);
        }
    });
}

export function persistGenerationHistoryRecords<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>, records: T[]) {
    return serializeHistoryOperation(options, async () => {
        const local = records.map((record) => withLocalOwnership(record, options.userId));
        await Promise.all(local.map((record) => options.store.setItem(generationHistoryCacheKey(options.userId, record.id), record)));
        if (!PUBLIC_MODE || !options.userId) return Promise.all(local.map(options.hydrate));

        const { prepared, failed } = await prepareHistoryRecords(local, options.prepare, options.userId);
        if (!prepared.length) return Promise.all(failed.map(options.hydrate));
        try {
            const response = await mergeServerGenerationHistoryBatches(options.kind, prepared, options.userId);
            const canonical = (response.items as T[]).map((record) => withLocalOwnership(record, options.userId));
            const merged = activeGenerationHistoryRecords(mergeGenerationHistoryRecords(failed, canonical));
            await replaceOwnedHistoryCache(options.store, options.userId, merged);
            return Promise.all(merged.map(options.hydrate));
        } catch (error) {
            reportHistorySyncError(error);
            return Promise.all(local.map(options.hydrate));
        }
    });
}

export function deleteGenerationHistoryRecords<T extends GenerationHistoryRecord>(options: Pick<HistorySyncOptions<T>, "kind" | "userId" | "store">, ids: string[], jobIds: string[] = []) {
    return serializeHistoryOperation(options, async () => {
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (PUBLIC_MODE && options.userId) await deleteServerGenerationHistoryItems(options.kind, uniqueIds, jobIds, options.userId);
        await Promise.all(uniqueIds.flatMap((id) => [options.store.removeItem(generationHistoryCacheKey(options.userId, id)), removeLegacyCacheItem(options.store, options.userId, id)]));
    });
}

export function mergeGenerationHistoryRecords<T extends GenerationHistoryRecord>(local: T[], remote: T[]) {
    const records = new Map<string, T>();
    const remoteTombstones = new Set(remote.filter(isGenerationHistoryTombstone).map((item) => item.id));
    for (const item of remote) records.set(item.id, item);
    for (const item of local) {
        if (remoteTombstones.has(item.id)) continue;
        const current = records.get(item.id);
        if (!current || recordVersion(item) > recordVersion(current)) records.set(item.id, item);
    }
    return Array.from(records.values()).sort((left, right) => recordVersion(right) - recordVersion(left));
}

export function activeGenerationHistoryRecords<T extends GenerationHistoryRecord>(records: T[]) {
    return records.filter((record) => !isGenerationHistoryTombstone(record));
}

export function filterGenerationHistoryRecords<T extends GenerationHistoryRecord>(records: T[], query: Pick<GenerationHistoryPageQuery, "search" | "model" | "status">) {
    const search = String(query.search || "")
        .trim()
        .toLocaleLowerCase();
    const model = String(query.model || "").trim();
    return [...records]
        .filter((record) => {
            if (search && !generationHistorySearchText(record).includes(search)) return false;
            if (model && generationHistoryModel(record) !== model) return false;
            if (query.status && generationHistoryStatus(record) !== query.status) return false;
            return true;
        })
        .sort((left, right) => recordVersion(right) - recordVersion(left));
}

export function recordBelongsToUser(record: Pick<GenerationHistoryRecord, "ownerUserId">, userId: string) {
    return !record.ownerUserId || record.ownerUserId === userId;
}

async function synchronizeNow<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>) {
    const local = await readOwnedHistoryCache<T>(options.store, options.userId);
    if (!PUBLIC_MODE || !options.userId) return Promise.all(local.map(options.hydrate));

    let remote: T[];
    try {
        const pages: T[] = [];
        let page = 1;
        for (;;) {
            const response = await fetchServerGenerationHistory(options.kind, options.userId, { page, pageSize: 200 });
            pages.push(...(response.items as T[]));
            if (!response.hasMore) break;
            page += 1;
            if (page > 25) break;
        }
        remote = pages;
    } catch (error) {
        reportHistorySyncError(error);
        return Promise.all(local.map(options.hydrate));
    }

    const { prepared, failed } = await prepareHistoryRecords(local, options.prepare, options.userId);
    const remoteById = new Map(remote.map((record) => [record.id, record]));
    const upload = prepared.filter((record) => {
        const current = remoteById.get(record.id);
        if (current && isGenerationHistoryTombstone(current)) return false;
        return !current || recordVersion(record) > recordVersion(current);
    });

    let canonical = remote;
    let uploadSucceeded = true;
    if (upload.length) {
        try {
            canonical = (await mergeServerGenerationHistoryBatches(options.kind, upload, options.userId)).items as T[];
        } catch (error) {
            reportHistorySyncError(error);
            uploadSucceeded = false;
        }
    }

    const merged = activeGenerationHistoryRecords(reconcileGenerationHistoryRecords(local, failed, canonical, uploadSucceeded)).map((record) => withLocalOwnership(record, options.userId));
    await replaceOwnedHistoryCache(options.store, options.userId, merged);
    return Promise.all(merged.map(options.hydrate));
}

async function readOwnedHistoryCache<T extends GenerationHistoryRecord>(store: HistoryStore, userId: string) {
    const records: T[] = [];
    await store.iterate<T, void>((value) => {
        if (value && typeof value === "object" && typeof value.id === "string" && recordBelongsToUser(value, userId)) {
            records.push(withLocalOwnership(value, userId));
        }
    });
    return records;
}

async function replaceOwnedHistoryCache<T extends GenerationHistoryRecord>(store: HistoryStore, userId: string, records: T[]) {
    const removable: string[] = [];
    await store.iterate<T, void>((value, key) => {
        if (value && typeof value === "object" && recordBelongsToUser(value, userId)) removable.push(key);
    });
    await Promise.all(removable.map((key) => store.removeItem(key)));
    await Promise.all(records.map((record) => store.setItem(generationHistoryCacheKey(userId, record.id), withLocalOwnership(record, userId))));
}

async function prepareHistoryRecords<T extends GenerationHistoryRecord>(records: T[], prepare: (record: T, expectedUserId: string) => Promise<T>, expectedUserId: string) {
    const settled = await runWithConcurrency(records, HISTORY_PREPARE_CONCURRENCY, async (record): Promise<PromiseSettledResult<T>> => {
        try {
            return { status: "fulfilled", value: await prepare(record, expectedUserId) };
        } catch (reason) {
            return { status: "rejected", reason };
        }
    });
    const prepared: T[] = [];
    const failed: T[] = [];
    settled.forEach((result, index) => {
        if (result.status === "fulfilled") prepared.push(result.value);
        else {
            failed.push(records[index]);
            reportHistorySyncError(result.reason);
        }
    });
    return { prepared, failed };
}

async function mergeServerGenerationHistoryBatches<T extends GenerationHistoryRecord>(kind: GenerationHistoryKind, records: T[], expectedUserId: string) {
    let response: { items: Record<string, unknown>[] } = { items: [] };
    for (const batch of splitGenerationHistoryBatches(records)) {
        response = await mergeServerGenerationHistory(
            kind,
            batch.map((record) => stripLocalOwnership(record) as Record<string, unknown>),
            expectedUserId,
        );
    }
    return response;
}

export function reconcileGenerationHistoryRecords<T extends GenerationHistoryRecord>(local: T[], preparationFailed: T[], remote: T[], uploadSucceeded: boolean) {
    return mergeGenerationHistoryRecords(uploadSucceeded ? preparationFailed : local, remote);
}

export function splitGenerationHistoryBatches<T extends GenerationHistoryRecord>(records: T[]) {
    const batches: T[][] = [];
    let current: T[] = [];
    let currentBytes = 0;
    for (const record of records) {
        const recordBytes = new TextEncoder().encode(JSON.stringify(stripLocalOwnership(record))).byteLength + 1;
        if (current.length && (current.length >= HISTORY_UPLOAD_BATCH_ITEMS || currentBytes + recordBytes > HISTORY_UPLOAD_BATCH_BYTES)) {
            batches.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(record);
        currentBytes += recordBytes;
    }
    if (current.length) batches.push(current);
    return batches;
}

async function removeLegacyCacheItem(store: HistoryStore, userId: string, id: string) {
    let removable = false;
    await store.iterate<GenerationHistoryRecord, void>((value, key) => {
        if (key === id && value?.id === id && recordBelongsToUser(value, userId)) removable = true;
    });
    if (removable) await store.removeItem(id);
}

function serializeHistoryOperation<T>(options: { kind: GenerationHistoryKind; userId: string }, operation: () => Promise<T>) {
    const key = `${options.kind}:${options.userId || "local"}`;
    const previous = historyOperations.get(key) || Promise.resolve();
    const current = previous.then(operation, operation);
    historyOperations.set(key, current);
    return current.finally(() => {
        if (historyOperations.get(key) === current) historyOperations.delete(key);
    });
}

function withLocalOwnership<T extends GenerationHistoryRecord>(record: T, userId: string): T {
    return {
        ...record,
        ownerUserId: userId,
        updatedAt: Number(record.updatedAt || record.createdAt || Date.now()),
    };
}

function stripLocalOwnership<T extends GenerationHistoryRecord>(record: T): T {
    const result = { ...record };
    delete result.ownerUserId;
    return result;
}

export function generationHistoryCacheKey(userId: string, id: string) {
    return `history:${userId || "local"}:${id}`;
}

function generationHistoryMigrationKey(kind: GenerationHistoryKind, userId: string) {
    return `history-migration:v${HISTORY_MIGRATION_VERSION}:${kind}:${userId}`;
}

function generationHistorySearchText(record: GenerationHistoryRecord) {
    const source = record as GenerationHistoryRecord & { prompt?: unknown; title?: unknown };
    return `${String(source.prompt || "")} ${String(source.title || "")}`.toLocaleLowerCase();
}

function generationHistoryModel(record: GenerationHistoryRecord) {
    const source = record as GenerationHistoryRecord & { model?: unknown; config?: { imageModel?: unknown; model?: unknown } };
    return String(source.model || source.config?.imageModel || source.config?.model || "").trim();
}

function generationHistoryStatus(record: GenerationHistoryRecord): "success" | "failure" {
    const source = record as GenerationHistoryRecord & { status?: unknown; successCount?: unknown; imageCount?: unknown };
    const status = String(source.status || "")
        .trim()
        .toLowerCase();
    if (status === "成功" || status === "success" || status === "succeeded") return "success";
    if (status === "失败" || status === "failure" || status === "failed") return "failure";
    return Number(source.successCount || source.imageCount || 0) > 0 ? "success" : "failure";
}

function normalizeHistoryModels(values: unknown) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 200);
}

function recordVersion(record: GenerationHistoryRecord) {
    return Number(record.updatedAt || record.createdAt || 0);
}

function isGenerationHistoryTombstone(record: GenerationHistoryRecord) {
    return Number(record.deletedAt || 0) > 0;
}

function reportHistorySyncError(error: unknown) {
    if (typeof window === "undefined") return;
    const message = error instanceof Error ? error.message : "生成记录同步失败";
    window.dispatchEvent(new CustomEvent("canvas:generation-history-sync-error", { detail: { message } }));
}

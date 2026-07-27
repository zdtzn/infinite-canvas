import { PUBLIC_MODE } from "@/constant/runtime-config";
import { runWithConcurrency } from "@/lib/async-pool";
import { deleteServerGenerationHistoryItem, fetchServerGenerationHistory, mergeServerGenerationHistory, upsertServerGenerationHistoryItem } from "@/services/server-api";

export type GenerationHistoryKind = "image" | "video";

export type GenerationHistoryRecord = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    ownerUserId?: string;
};

type HistoryStore = {
    iterate<T, U>(iteratorCallback: (value: T, key: string, iterationNumber: number) => U): Promise<U>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
};

type HistorySyncOptions<T extends GenerationHistoryRecord> = {
    kind: GenerationHistoryKind;
    userId: string;
    store: HistoryStore;
    hydrate: (record: T) => Promise<T>;
    prepare: (record: T) => Promise<T>;
};

const historyOperations = new Map<string, Promise<unknown>>();
const HISTORY_PREPARE_CONCURRENCY = 4;
const HISTORY_UPLOAD_BATCH_ITEMS = 50;
const HISTORY_UPLOAD_BATCH_BYTES = 6 * 1024 * 1024;

export function synchronizeGenerationHistory<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>) {
    return serializeHistoryOperation(options, () => synchronizeNow(options));
}

export function persistGenerationHistoryRecord<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>, record: T) {
    return serializeHistoryOperation(options, async () => {
        const local = withLocalOwnership(record, options.userId);
        await options.store.setItem(generationHistoryCacheKey(options.userId, local.id), local);
        if (!PUBLIC_MODE || !options.userId) return options.hydrate(local);
        try {
            const prepared = stripLocalOwnership(await options.prepare(local));
            const response = await upsertServerGenerationHistoryItem(options.kind, prepared as Record<string, unknown>);
            const canonical = withLocalOwnership(response.item as T, options.userId);
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

        const { prepared, failed } = await prepareHistoryRecords(local, options.prepare);
        if (!prepared.length) return Promise.all(failed.map(options.hydrate));
        try {
            const response = await mergeServerGenerationHistoryBatches(options.kind, prepared);
            const canonical = (response.items as T[]).map((record) => withLocalOwnership(record, options.userId));
            const merged = mergeGenerationHistoryRecords(failed, canonical);
            await replaceOwnedHistoryCache(options.store, options.userId, merged);
            return Promise.all(merged.map(options.hydrate));
        } catch (error) {
            reportHistorySyncError(error);
            return Promise.all(local.map(options.hydrate));
        }
    });
}

export function deleteGenerationHistoryRecords<T extends GenerationHistoryRecord>(options: Pick<HistorySyncOptions<T>, "kind" | "userId" | "store">, ids: string[]) {
    return serializeHistoryOperation(options, async () => {
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        await Promise.all(uniqueIds.flatMap((id) => [options.store.removeItem(generationHistoryCacheKey(options.userId, id)), removeLegacyCacheItem(options.store, options.userId, id)]));
        if (!PUBLIC_MODE || !options.userId) return;
        const results = await Promise.allSettled(uniqueIds.map((id) => deleteServerGenerationHistoryItem(options.kind, id)));
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failure) reportHistorySyncError(failure.reason);
    });
}

export function mergeGenerationHistoryRecords<T extends GenerationHistoryRecord>(local: T[], remote: T[]) {
    const records = new Map<string, T>();
    for (const item of remote) records.set(item.id, item);
    for (const item of local) {
        const current = records.get(item.id);
        if (!current || recordVersion(item) > recordVersion(current)) records.set(item.id, item);
    }
    return Array.from(records.values()).sort((left, right) => recordVersion(right) - recordVersion(left));
}

export function recordBelongsToUser(record: Pick<GenerationHistoryRecord, "ownerUserId">, userId: string) {
    return !record.ownerUserId || record.ownerUserId === userId;
}

async function synchronizeNow<T extends GenerationHistoryRecord>(options: HistorySyncOptions<T>) {
    const local = await readOwnedHistoryCache<T>(options.store, options.userId);
    if (!PUBLIC_MODE || !options.userId) return Promise.all(local.map(options.hydrate));

    let remote: T[];
    try {
        remote = (await fetchServerGenerationHistory(options.kind)).items as T[];
    } catch (error) {
        reportHistorySyncError(error);
        return Promise.all(local.map(options.hydrate));
    }

    const { prepared, failed } = await prepareHistoryRecords(local, options.prepare);
    const remoteById = new Map(remote.map((record) => [record.id, record]));
    const upload = prepared.filter((record) => {
        const current = remoteById.get(record.id);
        return !current || recordVersion(record) > recordVersion(current);
    });

    let canonical = remote;
    let uploadSucceeded = true;
    if (upload.length) {
        try {
            canonical = (await mergeServerGenerationHistoryBatches(options.kind, upload)).items as T[];
        } catch (error) {
            reportHistorySyncError(error);
            uploadSucceeded = false;
        }
    }

    const merged = reconcileGenerationHistoryRecords(local, failed, canonical, uploadSucceeded).map((record) => withLocalOwnership(record, options.userId));
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

async function prepareHistoryRecords<T extends GenerationHistoryRecord>(records: T[], prepare: (record: T) => Promise<T>) {
    const settled = await runWithConcurrency(records, HISTORY_PREPARE_CONCURRENCY, async (record): Promise<PromiseSettledResult<T>> => {
        try {
            return { status: "fulfilled", value: await prepare(record) };
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

async function mergeServerGenerationHistoryBatches<T extends GenerationHistoryRecord>(kind: GenerationHistoryKind, records: T[]) {
    let response: { items: Record<string, unknown>[] } = { items: [] };
    for (const batch of splitGenerationHistoryBatches(records)) {
        response = await mergeServerGenerationHistory(
            kind,
            batch.map((record) => stripLocalOwnership(record) as Record<string, unknown>),
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

function recordVersion(record: GenerationHistoryRecord) {
    return Number(record.updatedAt || record.createdAt || 0);
}

function reportHistorySyncError(error: unknown) {
    if (typeof window === "undefined") return;
    const message = error instanceof Error ? error.message : "生成记录同步失败";
    window.dispatchEvent(new CustomEvent("canvas:generation-history-sync-error", { detail: { message } }));
}

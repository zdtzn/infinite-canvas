import { serverRequest } from "./server-api";

export type StorageFile = {
    key: string; bytes: number; mimeType: string; createdAt: number;
    status: "referenced" | "recent" | "unused"; references: string[];
};
export type StorageOverview = {
    usedBytes: number; limitBytes: number; remainingBytes: number; referencedBytes: number;
    reclaimableBytes: number; protectedBytes: number; totalFiles: number; graceMs: number;
    generationOutputs: { usedBytes: number; limitBytes: number };
    byKind: Array<{ kind: string; bytes: number; count: number }>;
    items: StorageFile[]; page: number; pageSize: number; total: number;
};

export function fetchStorageOverview(userId: string, page: number, filter: "all" | "unused", signal: AbortSignal) {
    return serverRequest<StorageOverview>(`/api/storage?page=${page}&filter=${filter}`, { expectedUserId: userId, signal });
}

export function cleanupStorageFiles(userId: string, keys: string[]) {
    return serverRequest<{ deletedCount: number; freedBytes: number; skippedCount: number }>("/api/storage/cleanup", {
        method: "POST", body: { keys, confirmed: true }, expectedUserId: userId,
    });
}

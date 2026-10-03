import { collectAssetStorageKeys } from "./asset-references";
import type { StoredAsset } from "../types";

export type StorageReferenceRoot = { label: string; value: unknown };
type StorageInput = { assets: Iterable<StoredAsset>; userId: string; references: ReadonlyMap<string, string[]>; now: number; graceMs: number };

export function indexStorageReferences(roots: Iterable<StorageReferenceRoot>) {
    const references = new Map<string, string[]>();
    for (const root of roots) {
        const label = root.label.slice(0, 100);
        for (const key of collectAssetStorageKeys(root.value)) {
            const labels = references.get(key) || [];
            if (!labels.includes(label) && labels.length < 8) labels.push(label);
            references.set(key, labels);
        }
    }
    return references;
}

function storageStatus(asset: StoredAsset, input: StorageInput) {
    if (input.references.has(asset.key)) return "referenced" as const;
    return asset.createdAt > input.now - Math.max(0, input.graceMs) ? "recent" as const : "unused" as const;
}

export function buildStorageOverview(input: StorageInput & { limitBytes: number; page?: number; pageSize?: number; filter?: string }) {
    const owned = Array.from(input.assets).filter(asset => asset.userId === input.userId);
    let usedBytes = 0, referencedBytes = 0, reclaimableBytes = 0, protectedBytes = 0;
    const byKind = new Map<string, { kind: string; bytes: number; count: number }>();
    const items = owned.map(asset => {
        const status = storageStatus(asset, input);
        usedBytes += asset.bytes;
        if (status === "referenced") referencedBytes += asset.bytes;
        else if (status === "recent") protectedBytes += asset.bytes;
        else reclaimableBytes += asset.bytes;
        const kind = /^(image|video|audio)\//.exec(asset.mimeType)?.[1] || "file";
        const summary = byKind.get(kind) || { kind, bytes: 0, count: 0 };
        summary.bytes += asset.bytes;
        summary.count++;
        byKind.set(kind, summary);
        return { key: asset.key, bytes: asset.bytes, mimeType: asset.mimeType, createdAt: asset.createdAt, status, references: input.references.get(asset.key) || [] };
    }).filter(item => input.filter !== "unused" || item.status === "unused")
        .sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
    const pageSize = Number.isFinite(input.pageSize) ? Math.max(1, Math.min(50, Math.floor(input.pageSize!))) : 20;
    const page = Math.min(Math.max(1, Math.ceil(items.length / pageSize)), Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page!)) : 1);
    return {
        usedBytes, limitBytes: input.limitBytes, remainingBytes: Math.max(0, input.limitBytes - usedBytes),
        referencedBytes, reclaimableBytes, protectedBytes, totalFiles: owned.length, graceMs: input.graceMs,
        byKind: Array.from(byKind.values()).sort((a, b) => b.bytes - a.bytes),
        total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize),
    };
}

export function planStorageCleanup(input: StorageInput & { keys: string[] }) {
    const owned = new Map(Array.from(input.assets).filter(asset => asset.userId === input.userId).map(asset => [asset.key, asset]));
    const removable: StoredAsset[] = [];
    const skipped: Array<{ key: string; reason: "missing" | "referenced" | "recent" }> = [];
    for (const key of new Set(input.keys)) {
        const asset = owned.get(key);
        if (!asset) { skipped.push({ key, reason: "missing" }); continue; }
        const status = storageStatus(asset, input);
        if (status !== "unused") skipped.push({ key, reason: status });
        else removable.push(asset);
    }
    return { removable, skipped };
}

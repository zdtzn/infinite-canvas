type UpdatedRecord = {
    id: string;
    createdAt: string;
    updatedAt: string;
};

export function planAssetLibraryHydration<T extends UpdatedRecord>({ local, remote, remoteInitialized, localAlreadyMigrated }: { local: T[]; remote: T[]; remoteInitialized: boolean; localAlreadyMigrated: boolean }) {
    if (localAlreadyMigrated || !local.length) {
        return { assets: remote, writeServer: false };
    }

    const assets = mergeAssetRecords(local, remote);
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const writeServer =
        !remoteInitialized ||
        local.some((item) => {
            const current = remoteById.get(item.id);
            return !current || recordVersion(item) > recordVersion(current);
        });
    return { assets, writeServer };
}

/**
 * A paginated server response is not enough input for a full-library replace.
 * During the one-time browser migration, fetch every server page first so a
 * local legacy asset cannot accidentally overwrite records that were omitted
 * from the first page.
 */
export function shouldFetchCompleteServerLibraryForMigration({ localCount, remoteInitialized, localAlreadyMigrated, remoteHasMore }: { localCount: number; remoteInitialized: boolean; localAlreadyMigrated: boolean; remoteHasMore: boolean }) {
    return localCount > 0 && remoteInitialized && !localAlreadyMigrated && remoteHasMore;
}

export function mergeAssetRecords<T extends UpdatedRecord>(local: T[], remote: T[]) {
    const records = new Map(remote.map((item) => [item.id, item]));
    for (const item of local) {
        const current = records.get(item.id);
        if (!current || recordVersion(item) > recordVersion(current)) records.set(item.id, item);
    }
    return Array.from(records.values()).sort((left, right) => recordVersion(right) - recordVersion(left));
}

function recordVersion(item: UpdatedRecord) {
    return Date.parse(item.updatedAt || item.createdAt) || 0;
}

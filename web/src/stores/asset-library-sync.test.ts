import { describe, expect, test } from "bun:test";

import { mergeAssetRecords, planAssetLibraryHydration, shouldFetchCompleteServerLibraryForMigration } from "./asset-library-sync";

type Item = { id: string; createdAt: string; updatedAt: string; value: string };

const localOnly: Item = { id: "local", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", value: "local" };
const remoteOnly: Item = { id: "remote", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", value: "remote" };

describe("asset library hydration", () => {
    test("requires every server page before replacing a populated existing catalog", () => {
        expect(
            shouldFetchCompleteServerLibraryForMigration({
                localCount: 1,
                remoteInitialized: true,
                localAlreadyMigrated: false,
                remoteHasMore: true,
            }),
        ).toBe(true);
        expect(
            shouldFetchCompleteServerLibraryForMigration({
                localCount: 0,
                remoteInitialized: true,
                localAlreadyMigrated: false,
                remoteHasMore: true,
            }),
        ).toBe(false);
        expect(
            shouldFetchCompleteServerLibraryForMigration({
                localCount: 1,
                remoteInitialized: true,
                localAlreadyMigrated: true,
                remoteHasMore: true,
            }),
        ).toBe(false);
    });

    test("merges legacy browser assets into an existing server catalog once", () => {
        const plan = planAssetLibraryHydration({
            local: [localOnly],
            remote: [remoteOnly],
            remoteInitialized: true,
            localAlreadyMigrated: false,
        });

        expect(plan.assets.map((item) => item.id)).toEqual(["remote", "local"]);
        expect(plan.writeServer).toBe(true);
    });

    test("uses the server as authoritative after the browser migration completed", () => {
        const plan = planAssetLibraryHydration({
            local: [localOnly],
            remote: [],
            remoteInitialized: true,
            localAlreadyMigrated: true,
        });

        expect(plan.assets).toEqual([]);
        expect(plan.writeServer).toBe(false);
    });

    test("keeps an unuploadable local item visible beside migrated server items", () => {
        const failedLocal = { ...localOnly, id: "failed", value: "still-local" };

        expect(mergeAssetRecords([failedLocal], [remoteOnly]).map((item) => item.id)).toEqual(["remote", "failed"]);
    });
});

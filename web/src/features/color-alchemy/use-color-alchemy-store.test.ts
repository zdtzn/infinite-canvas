import { beforeEach, describe, expect, test } from "bun:test";

import { createDefaultColorSettings } from "./settings";
import type { ColorAlchemyDocument } from "./types";
import { useColorAlchemyStore } from "./use-color-alchemy-store";

describe("Color Alchemy store", () => {
    beforeEach(() => {
        useColorAlchemyStore.setState({ ownerUserId: "", activeDocumentId: null, documents: [], hydrated: true });
    });

    test("isolates working documents when the website account changes", () => {
        const store = useColorAlchemyStore.getState();
        store.prepareForUser("user-a");
        store.openSource({ key: "image:a", title: "A", url: "/a.png" });
        expect(useColorAlchemyStore.getState().documents).toHaveLength(1);
        useColorAlchemyStore.getState().prepareForUser("user-b");
        expect(useColorAlchemyStore.getState().documents).toHaveLength(0);
        expect(useColorAlchemyStore.getState().ownerUserId).toBe("user-b");
    });

    test("keeps non-destructive settings history for undo and redo", () => {
        useColorAlchemyStore.getState().prepareForUser("user-a");
        const id = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A", url: "/a.png" });
        const edited = { ...createDefaultColorSettings(), exposure: 24 };
        useColorAlchemyStore.getState().replaceSettings(id, edited, true);
        expect(useColorAlchemyStore.getState().documents[0].settings.exposure).toBe(24);
        useColorAlchemyStore.getState().undo(id);
        expect(useColorAlchemyStore.getState().documents[0].settings.exposure).toBe(0);
        useColorAlchemyStore.getState().redo(id);
        expect(useColorAlchemyStore.getState().documents[0].settings.exposure).toBe(24);
    });

    test("restores the latest confirmed settings before undoing history", () => {
        useColorAlchemyStore.getState().prepareForUser("user-a");
        const id = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A", url: "/a.png" });
        useColorAlchemyStore.getState().replaceSettings(id, { ...createDefaultColorSettings(), exposure: 24 }, true);
        useColorAlchemyStore.getState().replaceSettings(id, { ...createDefaultColorSettings(), exposure: 41 });

        useColorAlchemyStore.getState().undo(id);
        expect(useColorAlchemyStore.getState().documents[0].settings.exposure).toBe(24);
        useColorAlchemyStore.getState().undo(id);
        expect(useColorAlchemyStore.getState().documents[0].settings.exposure).toBe(0);
    });

    test("creates independent adjustment drafts for the same source image", () => {
        useColorAlchemyStore.getState().prepareForUser("user-a");
        const first = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A", url: "/a.png" });
        useColorAlchemyStore.getState().replaceSettings(first, { ...createDefaultColorSettings(), exposure: 24 }, true);
        const second = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A2", url: "/a-new.png" });

        expect(second).not.toBe(first);
        expect(useColorAlchemyStore.getState().documents).toHaveLength(2);
        expect(useColorAlchemyStore.getState().documents.find((document) => document.id === first)?.settings.exposure).toBe(24);
    });

    test("keeps the newest cloud or local draft version during merge", () => {
        const older = document("draft", "2026-08-01T00:00:00.000Z");
        const newer = { ...older, source: { ...older.source, title: "更新后的草稿" }, updatedAt: "2026-08-02T00:00:00.000Z" };
        useColorAlchemyStore.setState({ ownerUserId: "user-a", activeDocumentId: older.id, documents: [older] });

        useColorAlchemyStore.getState().mergeDocuments([{ ...older, source: { ...older.source, title: "旧的云端草稿" }, updatedAt: "2026-07-31T00:00:00.000Z" }]);
        expect(useColorAlchemyStore.getState().documents[0].source.title).toBe("A");

        useColorAlchemyStore.getState().mergeDocuments([newer]);
        expect(useColorAlchemyStore.getState().documents[0].source.title).toBe("更新后的草稿");
    });
});

function document(id: string, updatedAt: string): ColorAlchemyDocument {
    const settings = createDefaultColorSettings();
    return {
        id,
        source: { key: "image:a", title: "A", url: "/a.png", storageKey: "image:a" },
        settings,
        history: [settings],
        historyIndex: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt,
    };
}

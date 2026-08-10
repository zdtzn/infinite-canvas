import { beforeEach, describe, expect, test } from "bun:test";

import { createDefaultColorSettings } from "./settings";
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

    test("reuses one document for the same source image", () => {
        useColorAlchemyStore.getState().prepareForUser("user-a");
        const first = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A", url: "/a.png" });
        const second = useColorAlchemyStore.getState().openSource({ key: "image:a", title: "A2", url: "/a-new.png" });
        expect(second).toBe(first);
        expect(useColorAlchemyStore.getState().documents).toHaveLength(1);
        expect(useColorAlchemyStore.getState().documents[0].source.url).toBe("/a-new.png");
    });
});

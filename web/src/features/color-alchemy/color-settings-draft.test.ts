import { describe, expect, test } from "bun:test";

import { commitColorSettingsDraft, resolveColorSettingsDraft, updateColorSettingsDraft } from "./color-settings-draft";
import { createDefaultColorSettings } from "./settings";

describe("Color Alchemy transient settings", () => {
    test("keeps slider changes transient until the interaction is committed", () => {
        const persisted = createDefaultColorSettings();
        const changed = { ...persisted, exposure: 28 };
        const draft = updateColorSettingsDraft(null, "document-a", changed);

        expect(resolveColorSettingsDraft(draft, "document-a", persisted)).toEqual(changed);
        expect(resolveColorSettingsDraft(draft, "document-b", persisted)).toBe(persisted);

        const committed = commitColorSettingsDraft(draft, "document-a", persisted);
        expect(committed.settings).toEqual(changed);
        expect(committed.draft).toBeNull();
    });

    test("falls back to persisted settings when there is no draft for the active document", () => {
        const persisted = { ...createDefaultColorSettings(), contrast: 14 };
        const foreignDraft = updateColorSettingsDraft(null, "document-b", { ...persisted, contrast: 42 });

        expect(commitColorSettingsDraft(foreignDraft, "document-a", persisted)).toEqual({ settings: persisted, draft: foreignDraft });
    });
});

import type { ColorSettings } from "./types";

export type ColorSettingsDraft = {
    documentId: string;
    settings: ColorSettings;
} | null;

export function updateColorSettingsDraft(_current: ColorSettingsDraft, documentId: string, settings: ColorSettings): ColorSettingsDraft {
    return { documentId, settings };
}

export function resolveColorSettingsDraft(draft: ColorSettingsDraft, documentId: string, persisted: ColorSettings) {
    return draft?.documentId === documentId ? draft.settings : persisted;
}

export function commitColorSettingsDraft(draft: ColorSettingsDraft, documentId: string, persisted: ColorSettings) {
    if (draft?.documentId !== documentId) return { settings: persisted, draft };
    return { settings: draft.settings, draft: null };
}

import { create } from "zustand";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";
const NODE_VIEW_KEY = "canvas-side-panel-node-view";

export type CanvasNodeViewMode = "list" | "grid";

type PreferenceReader = Pick<Storage, "getItem">;
type PreferenceWriter = Pick<Storage, "setItem">;

function preferenceStorage() {
    try {
        return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
    } catch {
        return null;
    }
}

export function readCanvasSidePanelPreference(storage: PreferenceReader | null | undefined, key: string) {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

export function writeCanvasSidePanelPreference(storage: PreferenceWriter | null | undefined, key: string, value: string) {
    try {
        storage?.setItem(key, value);
    } catch {
        // Browser privacy settings may disable local storage.
    }
}

function readPreference(key: string) {
    return readCanvasSidePanelPreference(preferenceStorage(), key);
}

function writePreference(key: string, value: string) {
    writeCanvasSidePanelPreference(preferenceStorage(), key, value);
}

function initialWidth() {
    const stored = Number(readPreference(WIDTH_KEY));
    if (!stored) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return true;
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches) return false;
    return readPreference(OPEN_KEY) !== "0";
}

export function persistCanvasSidePanelWidth(width: number) {
    writePreference(WIDTH_KEY, String(width));
}

type CanvasSidePanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    nodeViewMode: CanvasNodeViewMode;
    setWidth: (width: number) => void;
    setNodeViewMode: (mode: CanvasNodeViewMode) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    nodeViewMode: readPreference(NODE_VIEW_KEY) === "grid" ? "grid" : "list",
    setWidth: (width) => set({ width }),
    setNodeViewMode: (mode) => {
        writePreference(NODE_VIEW_KEY, mode);
        set({ nodeViewMode: mode });
    },
    openPanel: () => {
        writePreference(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        writePreference(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));

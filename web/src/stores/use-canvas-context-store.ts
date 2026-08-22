import { create } from "zustand";

export type CanvasContextNode = {
    id: string;
    type: string;
    title: string;
    text?: string;
    storageKey?: string;
};

export type CanvasContextSnapshot = {
    projectId: string;
    projectTitle: string;
    nodes: CanvasContextNode[];
    updatedAt: number;
};

type CanvasContextStore = {
    snapshot: CanvasContextSnapshot | null;
    setSnapshot: (snapshot: CanvasContextSnapshot | null) => void;
    clear: () => void;
};

export const useCanvasContextStore = create<CanvasContextStore>()((set) => ({
    snapshot: null,
    setSnapshot: (snapshot) => set({ snapshot }),
    clear: () => set({ snapshot: null }),
}));

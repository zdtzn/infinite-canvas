import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    serverRevision?: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    setProjectServerRevision: (id: string, revision: number) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let queuedPersistValue: StorageValue<CanvasStore> | null = null;
let queuedPersistName = CANVAS_STORE_KEY;

async function flushCanvasPersistence() {
    if (!queuedPersistValue) return;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const value = queuedPersistValue;
    const name = queuedPersistName;
    queuedPersistValue = null;
    await localForageStorage.setItem(name, JSON.stringify(value));
}

if (typeof window !== "undefined") {
    const flushOnBackground = () => void flushCanvasPersistence().catch(() => undefined);
    window.addEventListener("pagehide", flushOnBackground);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushOnBackground();
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        queuedPersistValue = value;
        queuedPersistName = name;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void flushCanvasPersistence().catch(() => undefined);
        }, 200);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects: projects.map(normalizeCanvasProject).filter((project): project is CanvasProject => Boolean(project)) }),
            setProjectServerRevision: (id, revision) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, serverRevision: revision } : project)),
                })),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            version: 3,
            storage: canvasStorage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<PersistedCanvasState>;
                return { projects: Array.isArray(value.projects) ? value.projects.map(normalizeCanvasProject).filter((project): project is CanvasProject => Boolean(project)) : [] } as CanvasStore;
            },
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

export function normalizeCanvasProject(source: unknown): CanvasProject | null {
    if (!source || typeof source !== "object") return null;
    const value = source as Partial<CanvasProject>;
    const id = typeof value.id === "string" && value.id ? value.id : "";
    if (!id) return null;
    const now = new Date().toISOString();
    const viewport = value.viewport && typeof value.viewport === "object" ? value.viewport : initialViewport;
    return {
        id,
        title: typeof value.title === "string" && value.title.trim() ? value.title : "未命名画布",
        createdAt: validDate(value.createdAt) ? value.createdAt! : now,
        updatedAt: validDate(value.updatedAt) ? value.updatedAt! : now,
        serverRevision: Number.isInteger(value.serverRevision) && Number(value.serverRevision) >= 0 ? Number(value.serverRevision) : undefined,
        nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeCanvasNode).filter((node): node is CanvasNodeData => Boolean(node)) : [],
        connections: Array.isArray(value.connections) ? value.connections.filter(isCanvasConnection) : [],
        chatSessions: Array.isArray(value.chatSessions) ? value.chatSessions : [],
        activeChatId: typeof value.activeChatId === "string" ? value.activeChatId : null,
        backgroundMode: value.backgroundMode === "dots" || value.backgroundMode === "blank" ? value.backgroundMode : "lines",
        showImageInfo: Boolean(value.showImageInfo),
        viewport: { x: finiteNumber(viewport.x, 0), y: finiteNumber(viewport.y, 0), k: Math.max(0.1, finiteNumber(viewport.k, 1)) },
    };
}

function normalizeCanvasNode(source: unknown, index: number): CanvasNodeData | null {
    if (!source || typeof source !== "object") return null;
    const value = source as Partial<CanvasNodeData>;
    const type = typeof value.type === "string" && value.type ? value.type : CanvasNodeType.Text;
    const position = value.position && typeof value.position === "object" ? value.position : { x: 0, y: 0 };
    return {
        id: typeof value.id === "string" && value.id ? value.id : `legacy-node-${index}`,
        type,
        title: typeof value.title === "string" && value.title ? value.title : "未命名节点",
        position: { x: finiteNumber(position.x, 0), y: finiteNumber(position.y, 0) },
        width: Math.max(40, finiteNumber(value.width, 320)),
        height: Math.max(40, finiteNumber(value.height, 220)),
        metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {},
    };
}

function isCanvasConnection(value: unknown): value is CanvasConnection {
    if (!value || typeof value !== "object") return false;
    const connection = value as Partial<CanvasConnection>;
    return Boolean(connection.id && connection.fromNodeId && connection.toNodeId);
}

function finiteNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function validDate(value: unknown): value is string {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}

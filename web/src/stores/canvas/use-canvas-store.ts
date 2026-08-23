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
    snapshots: CanvasProjectSnapshot[];
};

export type CanvasProjectSnapshot = {
    id: string;
    title: string;
    createdAt: string;
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
    ownerUserId: string;
    projects: CanvasProject[];
    prepareForUser: (userId: string) => void;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    setProjectServerRevision: (id: string, revision: number) => void;
    createSnapshot: (projectId: string, snapshot: Omit<CanvasProjectSnapshot, "id" | "createdAt"> & Partial<Pick<CanvasProjectSnapshot, "id" | "createdAt">>) => CanvasProjectSnapshot | null;
    deleteSnapshot: (projectId: string, snapshotId: string) => void;
    restoreSnapshot: (projectId: string, snapshotId: string) => CanvasProjectSnapshot | null;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "ownerUserId" | "projects">;
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
        if (queuedPersistState && queuedPersistState.ownerUserId === nextState.ownerUserId && queuedPersistState.projects === nextState.projects) return;
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
            ownerUserId: "",
            projects: [],
            prepareForUser: (userId) => {
                const nextUserId = userId.trim();
                if (!nextUserId) return;
                const current = get();
                if (current.ownerUserId === nextUserId) return;
                if (!current.ownerUserId) {
                    set({ ownerUserId: nextUserId });
                    return;
                }
                set({ ownerUserId: nextUserId, projects: [] });
            },
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
                    snapshots: [],
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
                    snapshots: normalizeCanvasSnapshots(source.snapshots),
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
            createSnapshot: (projectId, input) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return null;
                const snapshot: CanvasProjectSnapshot = {
                    id: input.id || nanoid(),
                    title: input.title?.trim() || `快照 ${project.snapshots.length + 1}`,
                    createdAt: input.createdAt || new Date().toISOString(),
                    nodes: input.nodes,
                    connections: input.connections,
                    chatSessions: input.chatSessions,
                    activeChatId: input.activeChatId,
                    backgroundMode: input.backgroundMode,
                    showImageInfo: input.showImageInfo,
                    viewport: input.viewport,
                };
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === projectId
                            ? { ...item, snapshots: [snapshot, ...item.snapshots].slice(0, 12), updatedAt: new Date().toISOString() }
                            : item,
                    ),
                }));
                return snapshot;
            },
            deleteSnapshot: (projectId, snapshotId) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === projectId
                            ? { ...project, snapshots: project.snapshots.filter((snapshot) => snapshot.id !== snapshotId), updatedAt: new Date().toISOString() }
                            : project,
                    ),
                })),
            restoreSnapshot: (projectId, snapshotId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const snapshot = project?.snapshots.find((item) => item.id === snapshotId);
                if (!project || !snapshot) return null;
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === projectId
                            ? {
                                  ...item,
                                  nodes: snapshot.nodes,
                                  connections: snapshot.connections,
                                  chatSessions: snapshot.chatSessions,
                                  activeChatId: snapshot.activeChatId,
                                  backgroundMode: snapshot.backgroundMode,
                                  showImageInfo: snapshot.showImageInfo,
                                  viewport: snapshot.viewport,
                                  updatedAt: new Date().toISOString(),
                              }
                            : item,
                    ),
                }));
                return snapshot;
            },
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            version: 4,
            storage: canvasStorage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<PersistedCanvasState>;
                return {
                    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
                    projects: Array.isArray(value.projects) ? value.projects.map(normalizeCanvasProject).filter((project): project is CanvasProject => Boolean(project)) : [],
                } as CanvasStore;
            },
            partialize: (state) =>
                ({
                    ownerUserId: state.ownerUserId,
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
        snapshots: normalizeCanvasSnapshots(value.snapshots),
    };
}

function normalizeCanvasSnapshots(value: unknown): CanvasProjectSnapshot[] {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 12)
        .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<CanvasProjectSnapshot>;
            const viewport = source.viewport && typeof source.viewport === "object" ? source.viewport : initialViewport;
            const id = typeof source.id === "string" && source.id ? source.id : `snapshot-${index}`;
            return {
                id,
                title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `快照 ${index + 1}`,
                createdAt: validDate(source.createdAt) ? source.createdAt! : new Date().toISOString(),
                nodes: Array.isArray(source.nodes) ? source.nodes.map(normalizeCanvasNode).filter((node): node is CanvasNodeData => Boolean(node)) : [],
                connections: Array.isArray(source.connections) ? source.connections.filter(isCanvasConnection) : [],
                chatSessions: Array.isArray(source.chatSessions) ? source.chatSessions : [],
                activeChatId: typeof source.activeChatId === "string" ? source.activeChatId : null,
                backgroundMode: source.backgroundMode === "dots" || source.backgroundMode === "blank" ? source.backgroundMode : "lines",
                showImageInfo: Boolean(source.showImageInfo),
                viewport: { x: finiteNumber(viewport.x, 0), y: finiteNumber(viewport.y, 0), k: Math.max(0.1, finiteNumber(viewport.k, 1)) },
            } satisfies CanvasProjectSnapshot;
        })
        .filter((snapshot): snapshot is CanvasProjectSnapshot => Boolean(snapshot));
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

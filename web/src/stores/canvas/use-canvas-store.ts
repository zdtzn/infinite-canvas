import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import localforage from "localforage";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    serverRevision?: number;
    pendingSync?: boolean;
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

export type CanvasDeletedProject = { id: string; deletedAt: string; serverRevision?: number; serverDeleted?: boolean };

export function mergeCanvasDeletedProjects(...lists: CanvasDeletedProject[][]): CanvasDeletedProject[] {
    const merged = new Map<string, CanvasDeletedProject>();
    for (const item of lists.flat()) {
        if (!item || typeof item.id !== "string" || !item.id || !Number.isFinite(Date.parse(item.deletedAt))) continue;
        const previous = merged.get(item.id);
        merged.set(item.id, {
            id: item.id,
            deletedAt: previous && Date.parse(previous.deletedAt) > Date.parse(item.deletedAt) ? previous.deletedAt : item.deletedAt,
            serverRevision: Math.max(previous?.serverRevision || 0, item.serverRevision || 0),
            serverDeleted: Boolean(previous?.serverDeleted || item.serverDeleted),
        });
    }
    return [...merged.values()];
}

type CanvasStore = {
    hydrated: boolean;
    ownerUserId: string;
    serverProjectsStatus: { userId: string; status: "ready" | "error" } | null;
    projectReloads: ReadonlyMap<string, number>;
    projects: CanvasProject[];
    pendingProjectsByUser: Record<string, CanvasProject[]>;
    deletedProjects: CanvasDeletedProject[];
    deletedProjectsByUser: Record<string, CanvasDeletedProject[]>;
    prepareForUser: (userId: string) => void;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    insertProject: (project: CanvasProject) => void;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    restoreDeleteConflict: (project: CanvasProject) => void;
    setProjectServerRevision: (project: CanvasProject, revision: number) => void;
    createSnapshot: (projectId: string, snapshot: Omit<CanvasProjectSnapshot, "id" | "createdAt"> & Partial<Pick<CanvasProjectSnapshot, "id" | "createdAt">>) => CanvasProjectSnapshot | null;
    deleteSnapshot: (projectId: string, snapshotId: string) => void;
    restoreSnapshot: (projectId: string, snapshotId: string) => CanvasProjectSnapshot | null;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

export function canvasProjectPayload({ serverRevision: _revision, pendingSync: _pending, ...project }: CanvasProject) {
    return project;
}

export function sameCanvasProjectVersion(left: CanvasProject, right: CanvasProject) {
    return left === right || (left.updatedAt === right.updatedAt && JSON.stringify(canvasProjectPayload(left)) === JSON.stringify(canvasProjectPayload(right)));
}

function editCanvasProject(project: CanvasProject, patch: Partial<CanvasProject>) {
    if (!(Object.keys(patch) as (keyof CanvasProject)[]).some((key) => !Object.is(project[key], patch[key]))) return project;
    const updatedAt = new Date(Math.max(Date.now(), (Date.parse(project.updatedAt) || 0) + 1)).toISOString();
    return { ...project, ...patch, updatedAt, pendingSync: true };
}

export function canvasProjectAvailability(state: Pick<CanvasStore, "hydrated" | "ownerUserId" | "projects" | "serverProjectsStatus">, projectId: string, userId?: string) {
    if (!state.hydrated || (userId !== undefined && (!userId || state.ownerUserId !== userId))) return "loading";
    if (state.projects.some(project => project.id === projectId)) return "available";
    if (userId === undefined) return "missing";
    if (state.serverProjectsStatus?.userId !== userId) return "loading";
    return state.serverProjectsStatus.status === "ready" ? "missing" : "error";
}

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const CANVAS_RELOAD_KEY = `${CANVAS_STORE_KEY}:reload`;
type PersistedCanvasState = Pick<CanvasStore, "ownerUserId" | "projects" | "pendingProjectsByUser" | "deletedProjects" | "deletedProjectsByUser">;
type CanvasAccountCache = Pick<PersistedCanvasState, "projects" | "deletedProjects">;
type CanvasStorageValue = StorageValue<PersistedCanvasState> & { writtenAt?: number };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let persistedCanvasState: PersistedCanvasState | null = null;
let queuedPersistValue: StorageValue<CanvasStore> | null = null;
let queuedPersistName = CANVAS_STORE_KEY;
let persistence = Promise.resolve();
let stagedReloadState: PersistedCanvasState | null = null;

function accountCache(state: PersistedCanvasState | null, owner: string): CanvasAccountCache {
    const projects = state?.ownerUserId === owner ? state.projects : state?.pendingProjectsByUser?.[owner];
    const deletedProjects = state?.ownerUserId === owner ? state.deletedProjects : state?.deletedProjectsByUser?.[owner];
    return {
        projects: Array.isArray(projects) ? projects : [],
        deletedProjects: Array.isArray(deletedProjects) ? deletedProjects : [],
    };
}

function sameDeletion(left: CanvasDeletedProject, right?: CanvasDeletedProject) {
    return Boolean(right && left.deletedAt === right.deletedAt && left.serverRevision === right.serverRevision && left.serverDeleted === right.serverDeleted);
}

// IndexedDB is shared by tabs. Apply the changes from this tab to the latest
// stored account cache so a different canvas edited in another tab survives.
function mergeAccountCache(before: CanvasAccountCache, local: CanvasAccountCache, disk: CanvasAccountCache): CanvasAccountCache {
    const base = new Map(before.projects.map((project) => [project.id, project]));
    const projects = new Map(disk.projects.map((project) => [project.id, project]));
    for (const project of local.projects) {
        const stored = projects.get(project.id);
        const previous = base.get(project.id);
        if (stored && previous === project) continue;
        const storedRevision = stored?.serverRevision || 0;
        if (stored && storedRevision > (project.serverRevision || 0) && (!project.pendingSync || sameCanvasProjectVersion(stored, project))) continue;
        if (stored && !previous && storedRevision === (project.serverRevision || 0) && stored.updatedAt > project.updatedAt) continue;
        if (stored?.pendingSync && (!previous || !sameCanvasProjectVersion(stored, previous))) {
            if ((!project.pendingSync && !sameCanvasProjectVersion(stored, project)) || (project.pendingSync && stored.updatedAt > project.updatedAt)) continue;
        }
        projects.set(project.id, project);
    }
    const localDeletions = new Map(local.deletedProjects.map((item) => [item.id, item]));
    const baseDeletions = new Map(before.deletedProjects.map((item) => [item.id, item]));
    const existing = disk.deletedProjects.filter((item) => item.serverDeleted || !sameDeletion(item, baseDeletions.get(item.id)) || localDeletions.has(item.id));
    const added = local.deletedProjects.filter((item) => !sameDeletion(item, baseDeletions.get(item.id)));
    const deletedProjects = mergeCanvasDeletedProjects(existing, added);
    for (const item of deletedProjects) projects.delete(item.id);
    return { projects: [...projects.values()], deletedProjects };
}

function hasLocalDraft(project: CanvasProject) {
    return project.pendingSync ?? !project.serverRevision;
}

function mergePersistedCanvasState(before: PersistedCanvasState | null, local: PersistedCanvasState, disk: PersistedCanvasState) {
    const owner = local.ownerUserId;
    const owners = new Set([disk.ownerUserId, before?.ownerUserId || "", owner]);
    for (const state of [before, local, disk]) {
        for (const key of Object.keys(state?.pendingProjectsByUser || {})) owners.add(key);
        for (const key of Object.keys(state?.deletedProjectsByUser || {})) owners.add(key);
    }
    const account = (id: string) => mergeAccountCache(accountCache(before, id), accountCache(local, id), accountCache(disk, id));
    const dormant = [...owners].filter((id) => id && id !== owner).map((id) => [id, account(id)] as const);
    return {
        ownerUserId: owner,
        ...account(owner),
        pendingProjectsByUser: Object.fromEntries(dormant.map(([id, cache]) => [id, cache.projects.filter(hasLocalDraft)])),
        deletedProjectsByUser: Object.fromEntries(dormant.map(([id, cache]) => [id, cache.deletedProjects])),
    };
}

function readBrowserCanvasCache(storage: "localStorage" | "sessionStorage", name: string) {
    try {
        return typeof window === "undefined" ? null : window[storage].getItem(name);
    } catch {
        return null;
    }
}

function decodeCanvasStorage(value: string | null): CanvasStorageValue | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as CanvasStorageValue;
        return parsed?.state ? parsed : null;
    } catch {
        return null;
    }
}

async function readCanvasStorage(name: string) {
    const value = await localForageStorage.getItem(name);
    const stored = decodeCanvasStorage(value);
    const backup = readBrowserCanvasCache("localStorage", name);
    const fallback = backup === value ? null : decodeCanvasStorage(backup);
    return mergeCanvasStorageValues(stored, fallback);
}

function mergeCanvasStorageValues(stored: CanvasStorageValue | null, fallback: CanvasStorageValue | null) {
    if (!stored || !fallback) return stored || fallback;
    // A tab can fall back to localStorage while another tab is writing IndexedDB.
    const [newer, older] = (fallback.writtenAt || 0) >= (stored.writtenAt || 0) ? [fallback, stored] : [stored, fallback];
    return { ...newer, state: mergePersistedCanvasState(null, newer.state, older.state) };
}

function stageCanvasReload() {
    const current = queuedPersistState;
    if (!current || current === persistedCanvasState || current === stagedReloadState) return true;
    const drafts = (owner: string, projects: CanvasProject[]) => {
        const previous = new Map(accountCache(persistedCanvasState, owner).projects.map((project) => [project.id, project]));
        return projects.filter((project) => hasLocalDraft(project) && previous.get(project.id) !== project);
    };
    const state = {
        ...current,
        projects: drafts(current.ownerUserId, current.projects),
        pendingProjectsByUser: Object.fromEntries(Object.entries(current.pendingProjectsByUser).map(([owner, projects]) => [owner, drafts(owner, projects)])),
    };
    try {
        // Keep only the outstanding draft changes in this tab across an immediate reload.
        window.sessionStorage.setItem(CANVAS_RELOAD_KEY, JSON.stringify({ state, version: useCanvasStore.persist.getOptions().version, writtenAt: Date.now() }));
        stagedReloadState = current;
        return true;
    } catch {
        return false;
    }
}

function protectUnsavedCanvas(event: BeforeUnloadEvent) {
    if (stageCanvasReload()) return;
    event.preventDefault();
    event.returnValue = true;
}

export async function flushCanvasPersistence(strict = false) {
    const value = queuedPersistValue || (strict && queuedPersistState ? { state: queuedPersistState, version: useCanvasStore.persist.getOptions().version } : null);
    if (!value) return persistence;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const name = queuedPersistName;
    queuedPersistValue = null;
    const state = value.state as PersistedCanvasState;
    const write = async () => {
        const fallback = readBrowserCanvasCache("localStorage", name);
        const reload = readBrowserCanvasCache("sessionStorage", CANVAS_RELOAD_KEY);
        const stored = typeof window === "undefined" ? null : await readCanvasStorage(name);
        const disk = mergeCanvasStorageValues(stored, decodeCanvasStorage(reload));
        const serialized = JSON.stringify({
            ...value,
            state: disk ? mergePersistedCanvasState(persistedCanvasState, state, disk.state) : state,
            writtenAt: Math.max(Date.now(), (disk?.writtenAt || 0) + 1),
        });
        if (typeof window === "undefined") {
            if (strict) await localforage.setItem(name, serialized);
            else await localForageStorage.setItem(name, serialized);
        } else {
            try {
                await localforage.setItem(name, serialized);
            } catch (error) {
                if (strict) throw error;
                window.localStorage.setItem(name, serialized);
            }
            if (fallback && fallback === readBrowserCanvasCache("localStorage", name)) window.localStorage.removeItem(name);
            if (reload && reload === readBrowserCanvasCache("sessionStorage", CANVAS_RELOAD_KEY)) window.sessionStorage.removeItem(CANVAS_RELOAD_KEY);
            if (queuedPersistState === state) window.removeEventListener?.("beforeunload", protectUnsavedCanvas);
        }
        persistedCanvasState = state;
    };
    const operation = persistence.then(async () => {
        if (typeof window !== "undefined" && window.navigator?.locks) await window.navigator.locks.request(name, write);
        else await write();
    });
    persistence = operation.catch(() => undefined);
    try {
        await operation;
    } catch (error) {
        if (!queuedPersistValue && queuedPersistState === state) queuedPersistValue = value as StorageValue<CanvasStore>;
        throw error;
    }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const flushOnBackground = () => {
        stageCanvasReload();
        void flushCanvasPersistence().catch(() => undefined);
    };
    window.addEventListener("pagehide", flushOnBackground);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushOnBackground();
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const parsed = await readCanvasStorage(name);
        const recovered = mergeCanvasStorageValues(parsed, decodeCanvasStorage(readBrowserCanvasCache("sessionStorage", CANVAS_RELOAD_KEY)));
        persistedCanvasState = parsed?.state || null;
        queuedPersistState = parsed === recovered ? persistedCanvasState : null;
        return recovered as StorageValue<CanvasStore> | null;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && (Object.keys(nextState) as (keyof PersistedCanvasState)[]).every((key) => queuedPersistState?.[key] === nextState[key])) return;
        queuedPersistState = nextState;
        queuedPersistValue = value;
        queuedPersistName = name;
        if (typeof window !== "undefined") window.addEventListener?.("beforeunload", protectUnsavedCanvas);
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
            serverProjectsStatus: null,
            projectReloads: new Map(),
            projects: [],
            pendingProjectsByUser: {},
            deletedProjects: [],
            deletedProjectsByUser: {},
            prepareForUser: (userId) => {
                const nextUserId = userId.trim();
                if (!nextUserId) return;
                const current = get();
                if (current.ownerUserId === nextUserId) return;
                if (!current.ownerUserId) {
                    set({ ownerUserId: nextUserId });
                    return;
                }
                const deletedProjectsByUser = { ...current.deletedProjectsByUser, [current.ownerUserId]: current.deletedProjects };
                const pendingProjectsByUser = {
                    ...current.pendingProjectsByUser,
                    [current.ownerUserId]: current.projects.filter(hasLocalDraft),
                };
                const projects = Object.hasOwn(pendingProjectsByUser, nextUserId) ? pendingProjectsByUser[nextUserId] : [];
                delete pendingProjectsByUser[nextUserId];
                set({
                    ownerUserId: nextUserId,
                    projects,
                    pendingProjectsByUser,
                    projectReloads: new Map(),
                    deletedProjects: Object.hasOwn(deletedProjectsByUser, nextUserId) ? deletedProjectsByUser[nextUserId] : [],
                    deletedProjectsByUser,
                });
            },
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    pendingSync: true,
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
                    pendingSync: true,
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
            insertProject: (source) => {
                const project = normalizeCanvasProject(source);
                if (!project || get().deletedProjects.some((item) => item.id === project.id)) return;
                set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)] }));
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? editCanvasProject(project, { title: title.trim() || project.title }) : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    const deletedProjects = mergeCanvasDeletedProjects(
                        state.deletedProjects,
                        state.projects.filter((project) => ids.includes(project.id)).map((project) => ({ id: project.id, deletedAt: new Date().toISOString(), serverRevision: project.serverRevision })),
                    );
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deleted = []) =>
                set((state) => {
                    const deletedProjects = mergeCanvasDeletedProjects(state.deletedProjects, deleted);
                    const deletedIds = new Set(deletedProjects.map((item) => item.id));
                    const previous = new Map(state.projects.map((project) => [project.id, project]));
                    const projectReloads = new Map(state.projectReloads);
                    const next = projects.flatMap((source) => {
                        if (!source || deletedIds.has(source.id)) return [];
                        const before = previous.get(source.id);
                        if (before === source) return [source];
                        const project = normalizeCanvasProject(source);
                        if (!project) return [];
                        if (before) {
                            if (!sameCanvasProjectVersion(before, project)) projectReloads.set(project.id, (projectReloads.get(project.id) || 0) + 1);
                            else if (before.serverRevision === project.serverRevision && before.pendingSync === project.pendingSync) return [before];
                        }
                        return [project];
                    });
                    return { deletedProjects, projects: next, projectReloads };
                }),
            restoreDeleteConflict: (project) =>
                set((state) => {
                    // Only an authoritative cloud revision may cancel a still-pending local deletion.
                    const tombstone = state.deletedProjects.find((item) => item.id === project.id);
                    if (!tombstone || tombstone.serverDeleted || (project.serverRevision || 0) <= (tombstone.serverRevision || 0)) return state;
                    return {
                        deletedProjects: state.deletedProjects.filter((item) => item.id !== project.id),
                        projects: [project, ...state.projects.filter((item) => item.id !== project.id)],
                    };
                }),
            setProjectServerRevision: (saved, revision) =>
                set((state) => ({
                    projects: state.projects.map((project) => project.id === saved.id && (project.serverRevision ?? 0) <= revision
                        ? { ...project, serverRevision: revision, pendingSync: sameCanvasProjectVersion(project, saved) ? false : project.pendingSync }
                        : project),
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
                    projects: state.projects.map((item) => (item.id === projectId ? editCanvasProject(item, { snapshots: [snapshot, ...item.snapshots].slice(0, 12) }) : item)),
                }));
                return snapshot;
            },
            deleteSnapshot: (projectId, snapshotId) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === projectId && project.snapshots.some((snapshot) => snapshot.id === snapshotId)
                        ? editCanvasProject(project, { snapshots: project.snapshots.filter((snapshot) => snapshot.id !== snapshotId) })
                        : project)),
                })),
            restoreSnapshot: (projectId, snapshotId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const snapshot = project?.snapshots.find((item) => item.id === snapshotId);
                if (!project || !snapshot) return null;
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === projectId
                            ? editCanvasProject(item, {
                                  nodes: snapshot.nodes,
                                  connections: snapshot.connections,
                                  chatSessions: snapshot.chatSessions,
                                  activeChatId: snapshot.activeChatId,
                                  backgroundMode: snapshot.backgroundMode,
                                  showImageInfo: snapshot.showImageInfo,
                                  viewport: snapshot.viewport,
                              })
                            : item,
                    ),
                }));
                return snapshot;
            },
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? editCanvasProject(project, patch) : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            version: 5,
            storage: canvasStorage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<PersistedCanvasState>;
                return {
                    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
                    pendingProjectsByUser: value.pendingProjectsByUser || {},
                    deletedProjects: mergeCanvasDeletedProjects(Array.isArray(value.deletedProjects) ? value.deletedProjects : []),
                    deletedProjectsByUser: Object.fromEntries(Object.entries(value.deletedProjectsByUser || {}).map(([id, deleted]) => [id, mergeCanvasDeletedProjects(Array.isArray(deleted) ? deleted : [])])),
                    projects: Array.isArray(value.projects) ? value.projects.map(normalizeCanvasProject).filter((project): project is CanvasProject => Boolean(project)) : [],
                } as CanvasStore;
            },
            partialize: (state) =>
                ({
                    ownerUserId: state.ownerUserId,
                    projects: state.projects,
                    pendingProjectsByUser: state.pendingProjectsByUser,
                    deletedProjects: state.deletedProjects,
                    deletedProjectsByUser: state.deletedProjectsByUser,
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
        pendingSync: typeof value.pendingSync === "boolean" ? value.pendingSync : undefined,
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

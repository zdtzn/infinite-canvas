import { expect, test } from "bun:test";
import { mergeCanvasData } from "./app-sync";
import { normalizeCanvasProject, useCanvasStore } from "@/stores/canvas/use-canvas-store";

test("WebDAV tombstones suppress stale projects even with a future client clock", () => {
    const project = normalizeCanvasProject({ id: "deleted", updatedAt: "2099-01-01T00:00:00Z" })!;
    const local = { projects: [], deleted: [{ id: project.id, deletedAt: "2026-01-01T00:00:00Z", serverRevision: 5, serverDeleted: true }] };
    expect(mergeCanvasData(local, { projects: [project] }).projects).toEqual([]);
    expect(mergeCanvasData({ projects: [project] }, local).deleted?.[0]?.serverRevision).toBe(5);
});

test("legacy manifests without tombstones retain projects and repeated merge is stable", () => {
    const project = normalizeCanvasProject({ id: "legacy" })!;
    const first = mergeCanvasData({ projects: [] }, { projects: [project] });
    expect(first.projects[0]?.id).toBe("legacy");
    expect(mergeCanvasData(first, first)).toEqual(first);
});

test("two-device round trips propagate deletions without discarding edits to other projects", () => {
    const deleted = normalizeCanvasProject({ id: "removed", updatedAt: "2026-01-01T00:00:00Z" })!;
    const old = normalizeCanvasProject({ id: "kept", title: "old", updatedAt: "2026-01-01T00:00:00Z" })!;
    const edited = { ...old, title: "offline edit", updatedAt: "2026-01-02T00:00:00Z" };
    let a = { projects: [old], deleted: [{ id: deleted.id, deletedAt: "2026-01-03T00:00:00Z", serverDeleted: true, serverRevision: 7 }] };
    let b = mergeCanvasData({ projects: [deleted, edited] }, a);
    for (let round = 0; round < 5; round++) {
        b = mergeCanvasData(b, a);
        const merged = mergeCanvasData(a, b);
        a = { projects: merged.projects, deleted: merged.deleted as typeof a.deleted };
    }
    expect(a.projects.map((project) => [project.id, project.title])).toEqual([["kept", "offline edit"]]);
    expect(b.projects).toEqual(a.projects);
    expect(a.deleted).toHaveLength(1);
    expect(a.deleted[0].serverRevision).toBe(7);
});

test("a newer authoritative cloud revision cancels only an unconfirmed local deletion", () => {
    const project = normalizeCanvasProject({ id: "conflict", serverRevision: 3 })!;
    useCanvasStore.setState({ ownerUserId: "alice", projects: [project], deletedProjects: [] });
    useCanvasStore.getState().deleteProjects([project.id]);
    useCanvasStore.getState().restoreDeleteConflict(project);
    expect(useCanvasStore.getState().projects).toEqual([]);
    useCanvasStore.getState().restoreDeleteConflict({ ...project, serverRevision: 4 });
    expect(useCanvasStore.getState().projects[0]?.serverRevision).toBe(4);
    expect(useCanvasStore.getState().deletedProjects).toEqual([]);
    useCanvasStore.getState().replaceProjects([], [{ id: project.id, deletedAt: new Date().toISOString(), serverDeleted: true, serverRevision: 5 }]);
    useCanvasStore.getState().restoreDeleteConflict({ ...project, serverRevision: 6 });
    expect(useCanvasStore.getState().projects).toEqual([]);
});

test("local deletion retains revision, survives replacement and stays isolated across accounts", () => {
    const project = normalizeCanvasProject({ id: "private", serverRevision: 8 })!;
    useCanvasStore.setState({ ownerUserId: "a", projects: [project], deletedProjects: [], deletedProjectsByUser: {} });
    useCanvasStore.getState().deleteProjects([project.id]);
    expect(useCanvasStore.getState().deletedProjects[0]?.serverRevision).toBe(8);
    useCanvasStore.getState().replaceProjects([project]);
    expect(useCanvasStore.getState().projects).toEqual([]);
    useCanvasStore.getState().prepareForUser("b");
    expect(useCanvasStore.getState().deletedProjects).toEqual([]);
    useCanvasStore.getState().prepareForUser("a");
    expect(useCanvasStore.getState().deletedProjects[0]?.id).toBe("private");
    useCanvasStore.getState().replaceProjects([], [{ id: "private", deletedAt: new Date().toISOString(), serverRevision: 9, serverDeleted: true }]);
    expect(useCanvasStore.getState().deletedProjects[0]?.serverDeleted).toBe(true);
});

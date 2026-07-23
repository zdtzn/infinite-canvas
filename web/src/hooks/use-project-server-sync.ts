import { App } from "antd";
import { useEffect } from "react";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { deleteServerProject, fetchServerProjects, saveServerProject } from "@/services/server-api";
import { normalizeCanvasProject, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

type RemoteProject = { project: Record<string, unknown>; revision: number; updatedAt: number };

export function shouldUploadLocalProject(local: CanvasProject, remote: RemoteProject, remoteProject: CanvasProject) {
    if (local.serverRevision === undefined) return projectTimestamp(local.updatedAt) > projectTimestamp(remoteProject.updatedAt, remote.updatedAt);
    if (local.serverRevision > remote.revision) return true;
    if (local.serverRevision < remote.revision) return false;
    return projectTimestamp(local.updatedAt) > projectTimestamp(remoteProject.updatedAt, remote.updatedAt);
}

function projectTimestamp(value: string, fallback = 0) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : fallback;
}

function isProjectConflict(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("其他标签页") || message.includes("画布已删除");
}

export function useProjectServerSync() {
    const { message } = App.useApp();

    useEffect(() => {
        if (!PUBLIC_MODE) return;
        const revisions = new Map<string, number>();
        const timers = new Map<string, number>();
        const deletionTimers = new Map<string, number>();
        let active = true;
        let initialized = false;

        const showSaveError = (error: unknown) => {
            if (!active) return;
            message.error(`云端保存失败：${error instanceof Error ? error.message : "请检查网络后重试"}`);
        };

        const deleteRemote = (id: string, revision: number) => {
            void deleteServerProject(id, revision)
                .then(() => deletionTimers.delete(id))
                .catch((error) => {
                    if (isProjectConflict(error)) {
                        message.warning("画布已在其他位置更新或删除，本次删除未覆盖云端版本");
                        return;
                    }
                    showSaveError(error);
                    if (!active) return;
                    const existing = deletionTimers.get(id);
                    if (existing) window.clearTimeout(existing);
                    deletionTimers.set(id, window.setTimeout(() => deleteRemote(id, revision), 5_000));
                });
        };

        void waitForCanvasHydration(() => active)
            .then(() => fetchServerProjects())
            .then(({ items, deleted }) => {
                const localProjects = useCanvasStore.getState().projects;
                const remoteById = new Map(items.map((item) => [String(item.project.id || ""), item]));
                const deletedById = new Map(deleted.map((item) => [item.projectId, item]));
                const projectsToSave = new Set<string>();
                const merged: CanvasProject[] = [];

                for (const project of localProjects) {
                    const tombstone = deletedById.get(project.id);
                    if (tombstone) {
                        revisions.set(project.id, tombstone.revision);
                        continue;
                    }
                    const remote = remoteById.get(project.id);
                    if (!remote) {
                        projectsToSave.add(project.id);
                        merged.push(project);
                        continue;
                    }
                    revisions.set(project.id, remote.revision);
                    const remoteProject = normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision });
                    if (!remoteProject) {
                        projectsToSave.add(project.id);
                        merged.push(project);
                        continue;
                    }
                    if (shouldUploadLocalProject(project, remote, remoteProject)) {
                        projectsToSave.add(project.id);
                        merged.push(project);
                    } else {
                        merged.push(remoteProject);
                    }
                }

                const localIds = new Set(localProjects.map((project) => project.id));
                const recovered = items
                    .map((item) => normalizeCanvasProject({ ...item.project, serverRevision: item.revision }))
                    .filter((project): project is CanvasProject => Boolean(project && !localIds.has(project.id)));
                useCanvasStore.getState().replaceProjects([...recovered, ...merged]);
                recovered.forEach((project) => revisions.set(project.id, project.serverRevision || 0));
                initialized = true;
                useCanvasStore.getState().projects.filter((project) => projectsToSave.has(project.id)).forEach(schedule);
            })
            .catch((error) => {
                showSaveError(error);
                initialized = true;
                useCanvasStore.getState().projects.forEach(schedule);
            });

        const unsubscribe = useCanvasStore.subscribe((state, previous) => {
            if (!active || !initialized || !state.hydrated || state.projects === previous.projects) return;
            previous.projects
                .filter((project) => !state.projects.some((item) => item.id === project.id))
                .forEach((project) => {
                    const revision = revisions.get(project.id) ?? project.serverRevision ?? 0;
                    revisions.set(project.id, revision + 1);
                    deleteRemote(project.id, revision);
                });
            state.projects.forEach((project) => {
                const before = previous.projects.find((item) => item.id === project.id);
                if (!before || before.updatedAt !== project.updatedAt) schedule(project);
            });
        });

        function schedule(project: CanvasProject) {
            const existing = timers.get(project.id);
            if (existing) window.clearTimeout(existing);
            timers.set(
                project.id,
                window.setTimeout(() => {
                    timers.delete(project.id);
                    const revision = revisions.get(project.id) ?? project.serverRevision ?? 0;
                    void saveServerProject(project as unknown as Record<string, unknown>, revision)
                        .then((saved) => {
                            revisions.set(project.id, saved.revision);
                            useCanvasStore.getState().setProjectServerRevision(project.id, saved.revision);
                        })
                        .catch((error) => {
                            if (isProjectConflict(error)) {
                                message.warning("画布已在其他位置更新或删除，当前本地修改未覆盖云端版本");
                                return;
                            }
                            showSaveError(error);
                        });
                }, 1_200),
            );
        }

        return () => {
            active = false;
            unsubscribe();
            timers.forEach((timer) => window.clearTimeout(timer));
            deletionTimers.forEach((timer) => window.clearTimeout(timer));
        };
    }, [message]);
}

function waitForCanvasHydration(isActive: () => boolean) {
    if (useCanvasStore.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
            if (isActive()) return;
            window.clearInterval(timer);
            unsubscribe();
            resolve();
        }, 250);
        const unsubscribe = useCanvasStore.subscribe((state) => {
            if (!isActive() || !state.hydrated) return;
            window.clearInterval(timer);
            unsubscribe();
            resolve();
        });
    });
}

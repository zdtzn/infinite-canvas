import { App, Button } from "antd";
import { createElement, useEffect } from "react";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { deleteServerProject, fetchServerProjects, saveServerProject, ServerRequestError } from "@/services/server-api";
import { canvasProjectPayload, normalizeCanvasProject, sameCanvasProjectVersion, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

type RemoteProject = { project: Record<string, unknown>; revision: number; updatedAt: number };

export function shouldUploadLocalProject(local: CanvasProject, remote: RemoteProject, remoteProject: CanvasProject) {
    if (local.serverRevision === undefined) return projectTimestamp(local.updatedAt) > projectTimestamp(remoteProject.updatedAt, remote.updatedAt);
    if (local.serverRevision > remote.revision) return true;
    if (local.serverRevision < remote.revision) return false;
    return local.pendingSync ?? (projectTimestamp(local.updatedAt) > projectTimestamp(remoteProject.updatedAt, remote.updatedAt));
}

function projectTimestamp(value: string, fallback = 0) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : fallback;
}

function remoteTombstone(item: { projectId: string; deletedAt: number; revision: number }) {
    return { id: item.projectId, deletedAt: new Date(item.deletedAt).toISOString(), serverRevision: item.revision, serverDeleted: true };
}

function isProjectConflict(error: unknown) {
    return error instanceof ServerRequestError && error.status === 409 && (error.code === "REVISION_CONFLICT" || error.code === "PROJECT_DELETED");
}

export function useProjectServerSync(userId?: string) {
    const { message, notification } = App.useApp();

    useEffect(() => {
        if (!PUBLIC_MODE || !userId) return;

        const revisions = new Map<string, number>();
        const saveTimers = new Map<string, number>();
        const deletionRetryTimers = new Map<string, number>();
        const operationChains = new Map<string, Promise<void>>();
        let active = true;
        let initialized = false;
        let loadingProjects = false;

        const isCurrentSession = () => active && useUserStore.getState().user?.id === userId;
        const ownsCurrentStore = () => isCurrentSession() && useCanvasStore.getState().ownerUserId === userId;
        const showSaveError = (error: unknown) => {
            if (!ownsCurrentStore()) return;
            message.error(userFacingErrorMessage(error, "画布暂时未能同步，请检查网络"));
        };

        const enqueueProjectOperation = (projectId: string, operation: () => Promise<void>) => {
            const previous = operationChains.get(projectId) || Promise.resolve();
            const current = previous.then(operation, operation);
            operationChains.set(projectId, current);
            void current.then(
                () => {
                    if (operationChains.get(projectId) === current) operationChains.delete(projectId);
                },
                () => {
                    if (operationChains.get(projectId) === current) operationChains.delete(projectId);
                },
            );
            return current;
        };

        const scheduleSave = (projectId: string, delay = 1_200) => {
            if (!ownsCurrentStore()) return;
            const existing = saveTimers.get(projectId);
            if (existing) window.clearTimeout(existing);
            saveTimers.set(
                projectId,
                window.setTimeout(() => {
                    saveTimers.delete(projectId);
                    void enqueueProjectOperation(projectId, () => saveLatestProject(projectId));
                }, delay),
            );
        };

        const saveLatestProject = async (projectId: string) => {
            if (!ownsCurrentStore()) return;
            const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
            if (!project || project.pendingSync === false) return;
            if (loadingProjects) {
                scheduleSave(projectId);
                return;
            }
            const revision = revisions.get(projectId) ?? project.serverRevision ?? 0;
            try {
                const saved = await saveServerProject(canvasProjectPayload(project), revision, userId);
                if (!ownsCurrentStore()) return;
                revisions.set(projectId, saved.revision);
                useCanvasStore.getState().setProjectServerRevision(project, saved.revision);
            } catch (error) {
                if (!ownsCurrentStore()) return;
                if (isProjectConflict(error)) {
                    try {
                        await preserveConflictCopy(projectId);
                        return;
                    } catch (refreshError) {
                        error = refreshError;
                    }
                }
                showSaveError(error);
                if (useCanvasStore.getState().openProject(projectId)) scheduleSave(projectId, 5_000);
            }
        };

        function showConflictActions(copy: CanvasProject, originalProjectId: string, remoteAvailable: boolean) {
            const key = `canvas-conflict-${originalProjectId}`;
            notification.warning({
                key,
                duration: 0,
                message: "画布在其他地方有了更新",
                description: `你的修改已在此浏览器另存为“${copy.title}”。`,
                actions: createElement(
                    "div",
                    { className: "flex flex-wrap gap-2" },
                    createElement(Button, { href: `/canvas/${copy.id}`, size: "small", type: "primary", onClick: () => notification.destroy(key) }, "打开本地副本"),
                    remoteAvailable && createElement(Button, { href: `/canvas/${originalProjectId}`, size: "small", onClick: () => notification.destroy(key) }, "查看云端版本"),
                    createElement(
                        Button,
                        {
                            size: "small",
                            onClick: () => {
                                notification.destroy(key);
                                void import("@/lib/canvas/canvas-export")
                                    .then(({ exportCanvasProjects }) => exportCanvasProjects([copy], copy.title))
                                    .then(() => message.success("本地冲突副本已导出"))
                                    .catch(() => message.error("导出冲突副本失败，请稍后重试"));
                            },
                        },
                        "导出本地副本",
                    ),
                ),
            });
        }

        function createConflictCopy(project: CanvasProject) {
            const timestamp = new Date().toLocaleString("zh-CN", { hour12: false }).replace(/[/:]/g, "-");
            const title = project.title.slice(0, 120).replace(/\p{Cs}$/u, "");
            const state = useCanvasStore.getState();
            const id = state.importProject({ ...project, title: `${title} · 冲突副本 · ${timestamp}` });
            return state.openProject(id)!;
        }

        async function preserveConflictCopy(projectId: string) {
            const latest = await fetchServerProjects(userId);
            if (!ownsCurrentStore()) return;
            const state = useCanvasStore.getState();
            const draft = state.openProject(projectId);
            if (!draft || draft.pendingSync === false) return;
            const remote = latest.items.find((item) => item.project.id === projectId);
            const version = remote && normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision, pendingSync: false });
            const tombstone = latest.deleted.find((item) => item.projectId === projectId);
            if (!version && !tombstone) throw new Error("暂时无法确认云端画布版本，稍后将重试");
            const copy = version && sameCanvasProjectVersion(draft, version) ? null : createConflictCopy(draft);
            const projects = useCanvasStore.getState().projects.filter((item) => item.id !== projectId);
            if (version) {
                projects.push(version);
                revisions.set(projectId, version.serverRevision!);
            } else {
                revisions.delete(projectId);
            }
            state.replaceProjects(projects, tombstone ? [remoteTombstone(tombstone)] : []);
            if (copy) showConflictActions(copy, projectId, Boolean(version));
        }

        const scheduleDeleteRetry = (projectId: string) => {
            if (!active) return;
            const existing = deletionRetryTimers.get(projectId);
            if (existing) window.clearTimeout(existing);
            deletionRetryTimers.set(
                projectId,
                window.setTimeout(() => {
                    deletionRetryTimers.delete(projectId);
                    void enqueueProjectOperation(projectId, () => deleteRemoteProject(projectId));
                }, 5_000),
            );
        };

        const deleteRemoteProject = async (projectId: string) => {
            if (!ownsCurrentStore()) return;
            const tombstone = useCanvasStore.getState().deletedProjects.find((item) => item.id === projectId);
            if (!tombstone || tombstone.serverDeleted) return;
            if (loadingProjects) {
                scheduleDeleteRetry(projectId);
                return;
            }
            const revision = revisions.get(projectId) ?? tombstone?.serverRevision ?? 0;
            try {
                await deleteServerProject(projectId, revision, userId);
                if (!ownsCurrentStore()) return;
                const state = useCanvasStore.getState();
                state.replaceProjects(state.projects, [{ id: projectId, deletedAt: new Date().toISOString(), serverRevision: revision + 1, serverDeleted: true }]);
                revisions.delete(projectId);
                const retryTimer = deletionRetryTimers.get(projectId);
                if (retryTimer) window.clearTimeout(retryTimer);
                deletionRetryTimers.delete(projectId);
            } catch (error) {
                if (isProjectConflict(error)) {
                    try {
                        const latest = await fetchServerProjects(userId);
                        if (!ownsCurrentStore()) return;
                        const remote = latest.items.find((item) => String(item.project.id) === projectId);
                        if (remote) {
                            const project = normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision, pendingSync: false });
                            revisions.set(projectId, remote.revision);
                            if (project) useCanvasStore.getState().restoreDeleteConflict(project);
                        } else {
                            const deleted = latest.deleted.find((item) => item.projectId === projectId);
                            if (deleted) {
                                const state = useCanvasStore.getState();
                                state.replaceProjects(state.projects, [remoteTombstone(deleted)]);
                            }
                        }
                    } catch (refreshError) {
                        showSaveError(refreshError);
                        scheduleDeleteRetry(projectId);
                    }
                    if (active) message.warning("画布已在其他位置更新，本次删除未覆盖云端版本");
                    return;
                }
                showSaveError(error);
                scheduleDeleteRetry(projectId);
            }
        };

        const refreshProjects = async () => {
            if (loadingProjects || !ownsCurrentStore()) return;
            loadingProjects = true;
            try {
                await Promise.allSettled(operationChains.values());
                if (!ownsCurrentStore()) return;
                const { items, deleted } = await fetchServerProjects(userId);
                if (!ownsCurrentStore()) return;
                const state = useCanvasStore.getState();
                const remoteById = new Map(items.map((item) => [item.project.id, item]));
                const deletedById = new Map(deleted.map((item) => [item.projectId, item]));
                const localDeleted = new Set(state.deletedProjects.map((item) => item.id));
                const projectsToSave = new Set<string>();
                const merged: CanvasProject[] = [];
                const conflicts: Array<{ copy: CanvasProject; projectId: string; remoteAvailable: boolean }> = [];
                // Reconciliation updates the local cache and must not enqueue its own cloud writes.
                initialized = false;

                for (const project of state.projects) {
                    const tombstone = deletedById.get(project.id);
                    const remote = remoteById.get(project.id);
                    remoteById.delete(project.id);
                    const version = remote && normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision, pendingSync: false });
                    if (!tombstone && (!remote || !version || (project.serverRevision ?? 0) > remote.revision)) {
                        merged.push(project);
                        if (project.pendingSync !== false) projectsToSave.add(project.id);
                        continue;
                    }
                    const sameVersion = version && sameCanvasProjectVersion(project, version);
                    const dirty = !sameVersion && (project.pendingSync ?? Boolean(remote && version && shouldUploadLocalProject(project, remote, version)));
                    if (!tombstone && remote && version && dirty && (project.serverRevision ?? 0) === remote.revision) {
                        revisions.set(project.id, remote.revision);
                        projectsToSave.add(project.id);
                        merged.push(project);
                        continue;
                    }
                    if (dirty) {
                        const copy = createConflictCopy(project);
                        merged.push(copy);
                        projectsToSave.add(copy.id);
                        conflicts.push({ copy, projectId: project.id, remoteAvailable: Boolean(version && !tombstone) });
                    }
                    if (version && remote && !tombstone) {
                        revisions.set(project.id, remote.revision);
                        merged.push(version);
                    } else {
                        revisions.delete(project.id);
                    }
                }
                for (const remote of remoteById.values()) {
                    const project = normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision, pendingSync: false });
                    if (!project || localDeleted.has(project.id)) continue;
                    revisions.set(project.id, remote.revision);
                    merged.push(project);
                }

                state.replaceProjects(merged, deleted.map(remoteTombstone));
                initialized = true;
                useCanvasStore.setState({ serverProjectsStatus: { userId, status: "ready" } });
                for (const tombstone of useCanvasStore.getState().deletedProjects) {
                    if (!tombstone.serverDeleted) void enqueueProjectOperation(tombstone.id, () => deleteRemoteProject(tombstone.id));
                }
                for (const id of projectsToSave) scheduleSave(id);
                for (const conflict of conflicts) showConflictActions(conflict.copy, conflict.projectId, conflict.remoteAvailable);
            } catch (error) {
                if (!ownsCurrentStore()) return;
                initialized = true;
                showSaveError(error);
                if (useCanvasStore.getState().serverProjectsStatus?.status !== "ready") {
                    useCanvasStore.setState({ serverProjectsStatus: { userId, status: "error" } });
                }
                for (const project of useCanvasStore.getState().projects) {
                    if (project.pendingSync ?? !project.serverRevision) scheduleSave(project.id);
                }
                for (const tombstone of useCanvasStore.getState().deletedProjects) {
                    if (!tombstone.serverDeleted) scheduleDeleteRetry(tombstone.id);
                }
            } finally {
                loadingProjects = false;
            }
        };

        void waitForCanvasHydration(isCurrentSession).then(() => {
            if (!isCurrentSession()) return;
            useCanvasStore.getState().prepareForUser(userId);
            void refreshProjects();
        });

        const unsubscribe = useCanvasStore.subscribe((state, previous) => {
            if (!initialized || !state.hydrated || !ownsCurrentStore()) return;

            if (state.deletedProjects !== previous.deletedProjects) {
                const alreadyPending = new Set(previous.deletedProjects.map((project) => project.id));
                for (const tombstone of state.deletedProjects) {
                    if (tombstone.serverDeleted || alreadyPending.has(tombstone.id)) continue;
                    const timer = saveTimers.get(tombstone.id);
                    if (timer) window.clearTimeout(timer);
                    saveTimers.delete(tombstone.id);
                    void enqueueProjectOperation(tombstone.id, () => deleteRemoteProject(tombstone.id));
                }
            }
            if (state.projects === previous.projects) return;
            const previousById = new Map(previous.projects.map((project) => [project.id, project]));
            for (const project of state.projects) {
                if (project.pendingSync !== false && previousById.get(project.id)?.updatedAt !== project.updatedAt) scheduleSave(project.id);
            }
        });
        window.addEventListener("online", refreshProjects);

        return () => {
            active = false;
            unsubscribe();
            window.removeEventListener("online", refreshProjects);
            if (useCanvasStore.getState().serverProjectsStatus?.userId === userId) useCanvasStore.setState({ serverProjectsStatus: null });
            saveTimers.forEach((timer) => window.clearTimeout(timer));
            deletionRetryTimers.forEach((timer) => window.clearTimeout(timer));
        };
    }, [message, notification, userId]);
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

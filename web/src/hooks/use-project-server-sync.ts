import { App, Button } from "antd";
import { createElement, useEffect } from "react";

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
    return message.includes("其他标签页") || message.includes("画布已删除") || message.includes("其他位置");
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

        const ownsCurrentStore = () => active && useCanvasStore.getState().ownerUserId === userId;
        const showSaveError = (error: unknown) => {
            if (!active) return;
            message.error(`云端保存失败：${error instanceof Error ? error.message : "请检查网络后重试"}`);
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
            if (!project) return;
            const revision = revisions.get(projectId) ?? project.serverRevision ?? 0;
            try {
                const saved = await saveServerProject(project as unknown as Record<string, unknown>, revision, userId);
                revisions.set(projectId, saved.revision);
                if (ownsCurrentStore()) useCanvasStore.getState().setProjectServerRevision(projectId, saved.revision);
            } catch (error) {
                if (isProjectConflict(error)) {
                    await preserveConflictCopy(project, projectId);
                    return;
                }
                showSaveError(error);
                if (ownsCurrentStore() && useCanvasStore.getState().projects.some((item) => item.id === projectId)) scheduleSave(projectId, 5_000);
            }
        };

        function showConflictActions(copy: CanvasProject, originalProjectId: string, remoteAligned: boolean) {
            const key = `canvas-conflict-${originalProjectId}`;
            notification.warning({
                key,
                duration: 0,
                message: "检测到画布版本冲突",
                description: remoteAligned
                    ? `本地修改已保存为“${copy.title}”，原画布已对齐云端版本。`
                    : `本地修改已保存为“${copy.title}”，云端版本将在网络恢复后重新同步。`,
                actions: createElement(
                    "div",
                    { className: "flex flex-wrap gap-2" },
                    createElement(Button, { href: `/canvas/${copy.id}`, size: "small", type: "primary", onClick: () => notification.destroy(key) }, "打开本地副本"),
                    createElement(Button, { href: `/canvas/${originalProjectId}`, size: "small", onClick: () => notification.destroy(key) }, "查看云端版本"),
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

        async function preserveConflictCopy(localProject: CanvasProject, originalProjectId: string) {
            if (!ownsCurrentStore()) return;
            const timestamp = new Date().toLocaleString("zh-CN", { hour12: false }).replace(/[/:]/g, "-");
            const copyId = useCanvasStore.getState().importProject({
                ...localProject,
                title: `${localProject.title} · 冲突副本 · ${timestamp}`,
                serverRevision: undefined,
            });
            const copy = useCanvasStore.getState().projects.find((item) => item.id === copyId);
            if (!copy) return;

            try {
                const saved = await saveServerProject(copy as unknown as Record<string, unknown>, 0, userId);
                if (ownsCurrentStore()) useCanvasStore.getState().setProjectServerRevision(copyId, saved.revision);
            } catch (copyError) {
                if (active) message.error(`冲突副本保存失败：${copyError instanceof Error ? copyError.message : "请稍后重试"}`);
                return;
            }

            try {
                const latest = await fetchServerProjects(userId);
                const remote = latest.items.find((item) => String(item.project.id || "") === originalProjectId);
                const remoteProject = remote ? normalizeCanvasProject({ ...remote.project, serverRevision: remote.revision }) : null;
                const currentProjects = useCanvasStore.getState().projects.filter((item) => item.id !== originalProjectId);
                useCanvasStore.getState().replaceProjects(remoteProject ? [remoteProject, ...currentProjects] : currentProjects);
                if (remote) revisions.set(originalProjectId, remote.revision);
                else revisions.delete(originalProjectId);
                if (active) showConflictActions(copy, originalProjectId, true);
            } catch {
                if (active) showConflictActions(copy, originalProjectId, false);
            }
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
            if (!active) return;
            const revision = revisions.get(projectId) ?? 0;
            try {
                await deleteServerProject(projectId, revision, userId);
                revisions.delete(projectId);
                const retryTimer = deletionRetryTimers.get(projectId);
                if (retryTimer) window.clearTimeout(retryTimer);
                deletionRetryTimers.delete(projectId);
            } catch (error) {
                if (isProjectConflict(error)) {
                    if (active) message.warning("画布已在其他位置更新，本次删除未覆盖云端版本");
                    return;
                }
                showSaveError(error);
                scheduleDeleteRetry(projectId);
            }
        };

        void waitForCanvasHydration(() => active)
            .then(() => {
                if (!active) return null;
                useCanvasStore.getState().prepareForUser(userId);
                return fetchServerProjects(userId);
            })
            .then((response) => {
                if (!response || !ownsCurrentStore()) return;
                const { items, deleted } = response;
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
                    if (!remoteProject || shouldUploadLocalProject(project, remote, remoteProject)) {
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
                for (const projectId of projectsToSave) scheduleSave(projectId);
            })
            .catch((error) => {
                if (!ownsCurrentStore()) return;
                showSaveError(error);
                initialized = true;
                useCanvasStore.getState().projects.forEach((project) => scheduleSave(project.id));
            });

        const unsubscribe = useCanvasStore.subscribe((state, previous) => {
            if (!active || !initialized || !state.hydrated || state.ownerUserId !== userId || state.projects === previous.projects) return;

            const currentIds = new Set(state.projects.map((project) => project.id));
            const previousById = new Map(previous.projects.map((project) => [project.id, project]));
            for (const project of previous.projects) {
                if (currentIds.has(project.id)) continue;
                const timer = saveTimers.get(project.id);
                if (timer) window.clearTimeout(timer);
                saveTimers.delete(project.id);
                if (!revisions.has(project.id)) revisions.set(project.id, project.serverRevision ?? 0);
                void enqueueProjectOperation(project.id, () => deleteRemoteProject(project.id));
            }

            for (const project of state.projects) {
                const before = previousById.get(project.id);
                if (!before || before.updatedAt !== project.updatedAt) scheduleSave(project.id);
            }
        });

        return () => {
            active = false;
            unsubscribe();
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

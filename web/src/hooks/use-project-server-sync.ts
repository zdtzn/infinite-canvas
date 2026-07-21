import { App } from "antd";
import { useEffect } from "react";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { deleteServerProject, fetchServerProjects, saveServerProject } from "@/services/server-api";
import { normalizeCanvasProject, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

export function useProjectServerSync() {
    const { message } = App.useApp();

    useEffect(() => {
        if (!PUBLIC_MODE) return;
        const revisions = new Map<string, number>();
        const timers = new Map<string, number>();
        let active = true;
        let initialized = false;

        void waitForCanvasHydration(() => active)
            .then(() => fetchServerProjects())
            .then(({ items }) => {
                const localProjects = useCanvasStore.getState().projects;
                const remoteById = new Map(items.map((item) => [String(item.project.id || ""), item]));
                const merged = localProjects.map((project) => {
                    const remote = remoteById.get(project.id);
                    const remoteProject = normalizeCanvasProject(remote?.project);
                    if (!remote || !remoteProject) return project;
                    return remote.updatedAt > Date.parse(project.updatedAt || "") ? remoteProject : project;
                });
                const localIds = new Set(localProjects.map((project) => project.id));
                const recovered = items.map((item) => normalizeCanvasProject(item.project)).filter((project): project is CanvasProject => Boolean(project && !localIds.has(project.id)));
                items.forEach((item) => revisions.set(String(item.project.id || ""), item.revision));
                if (recovered.length || merged.some((project, index) => project !== localProjects[index])) useCanvasStore.getState().replaceProjects([...recovered, ...merged]);
            })
            .catch(() => undefined)
            .finally(() => {
                initialized = true;
                useCanvasStore.getState().projects.forEach(schedule);
            });

        const unsubscribe = useCanvasStore.subscribe((state, previous) => {
            if (!active || !initialized || !state.hydrated || state.projects === previous.projects) return;
            previous.projects
                .filter((project) => !state.projects.some((item) => item.id === project.id))
                .forEach((project) => {
                    revisions.delete(project.id);
                    void deleteServerProject(project.id).catch(() => undefined);
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
                    void saveServerProject(project as unknown as Record<string, unknown>, revisions.get(project.id) || 0)
                        .then((saved) => revisions.set(project.id, saved.revision))
                        .catch((error) => {
                            if (String(error).includes("其他标签页")) message.warning("画布已在其他位置更新，本次云端备份未覆盖旧版本");
                        });
                }, 1200),
            );
        }

        return () => {
            active = false;
            unsubscribe();
            timers.forEach((timer) => window.clearTimeout(timer));
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

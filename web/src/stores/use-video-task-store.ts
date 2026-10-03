import { useStore } from "zustand";
import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { createVideoTaskRuntime } from "@/services/video-task-runtime";
import { deleteVideoHistory, loadVideoHistory, saveVideoHistory } from "@/services/video-task-history";
import { videoSnapshotFromLog, videoTaskPhase } from "@/services/video-task-model";
import { useConfigStore } from "./use-config-store";
import { useUserStore } from "./use-user-store";
import { useWorkbenchAgentStore } from "./use-workbench-agent-store";

export const videoTaskOwner = () => (PUBLIC_MODE ? useUserStore.getState().user?.id || "" : "local");
const expectedUser = (owner: string) => (PUBLIC_MODE ? owner : useUserStore.getState().user?.id || "");

export const videoTasks = createVideoTaskRuntime({
    currentOwner: videoTaskOwner,
    load: loadVideoHistory,
    save: saveVideoHistory,
    remove: deleteVideoHistory,
    snapshot: (log) => videoSnapshotFromLog(log, useConfigStore.getState().config),
    create: (snapshot, owner, signal) =>
        createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), expectedUserId: expectedUser(owner) }),
    poll: (log, snapshot, owner, signal) => pollVideoGenerationTask(snapshot.config, log.task!, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), expectedUserId: expectedUser(owner) }),
    archive: async (result, log, owner) => {
        const stored = await storeGeneratedVideo({ ...result, ownerUserId: expectedUser(owner) });
        return { id: nanoid(), url: stored.url, storageKey: stored.storageKey, width: stored.width || 1280, height: stored.height || 720, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: Date.now() - log.createdAt };
    },
    onUpdate: (log) => {
        if (!log.agentTaskId || videoTaskOwner() !== log.ownerUserId) return;
        const phase = videoTaskPhase(log);
        const succeeded = phase === "succeeded";
        const failed = ["failed", "unknown", "canceled"].includes(phase);
        useWorkbenchAgentStore.getState().updateTask(log.agentTaskId, { status: succeeded ? "succeeded" : failed ? "failed" : "running", successCount: succeeded ? 1 : 0, failCount: failed ? 1 : 0, error: log.error });
    },
});

// Route unmounts do not own the runtime. Only changing accounts ends its lifetime.
useUserStore.subscribe(() => {
    void videoTasks.prepare(videoTaskOwner());
});

export function useVideoTaskStore<T>(selector: (state: ReturnType<typeof videoTasks.store.getState>) => T) {
    return useStore(videoTasks.store, selector);
}

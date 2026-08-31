import { prepareColorAlchemyForUser } from "@/features/color-alchemy/use-color-alchemy-store";
import { prepareImageGenerationRuntimeForUser } from "@/services/image-generation-runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { prepareAgentForUser } from "@/stores/use-agent-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import { resetWorkbenchAgentSession } from "@/stores/use-workbench-agent-store";

export function prepareAccountSession(previousUserId: string | null, userId: string) {
    if (previousUserId !== null) {
        resetWorkbenchAgentSession();
        useConfigStore.getState().clearSensitiveSession();
        useConfigStore.getState().clearAccountScopedPreferences();
    }

    useConfigStore.getState().prepareAccountPreferences(userId);
    prepareImageGenerationRuntimeForUser(userId);
    prepareColorAlchemyForUser(userId);
    useCanvasStore.getState().prepareForUser(userId);
    useAssetStore.getState().prepareForUser(userId);
    prepareAgentForUser(userId);
}

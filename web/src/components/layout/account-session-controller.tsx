import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";

import { prepareImageGenerationRuntimeForUser } from "@/services/image-generation-runtime";
import { prepareColorAlchemyForUser } from "@/features/color-alchemy/use-color-alchemy-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { prepareAgentForUser } from "@/stores/use-agent-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { resetWorkbenchAgentSession } from "@/stores/use-workbench-agent-store";

export function AccountSessionController() {
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id || "");
    const previousUserId = useRef<string | null>(null);

    useLayoutEffect(() => {
        const previous = previousUserId.current;
        if (previous === userId) return;
        previousUserId.current = userId;

        if (previous !== null) {
            void queryClient.cancelQueries();
            queryClient.clear();
            resetWorkbenchAgentSession();
            useConfigStore.getState().clearSensitiveSession();
        }

        prepareImageGenerationRuntimeForUser(userId);
        prepareColorAlchemyForUser(userId);
        useCanvasStore.getState().prepareForUser(userId);
        useAssetStore.getState().prepareForUser(userId);
        prepareAgentForUser(userId);
    }, [queryClient, userId]);

    return null;
}

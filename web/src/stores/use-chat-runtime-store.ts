import { create } from "zustand";

export type ChatRuntimeStatus = "idle" | "starting" | "streaming" | "stopping";

type ChatRuntimeStore = {
    pending: boolean;
    status: ChatRuntimeStatus;
    conversationId: string;
    startedAt: number;
    setRuntime: (patch: Partial<Pick<ChatRuntimeStore, "pending" | "status" | "conversationId" | "startedAt">>) => void;
    clearRuntime: (conversationId?: string) => void;
};

export const useChatRuntimeStore = create<ChatRuntimeStore>((set) => ({
    pending: false,
    status: "idle",
    conversationId: "",
    startedAt: 0,
    setRuntime: (patch) => set(patch),
    clearRuntime: (conversationId) =>
        set((state) => {
            if (conversationId && state.conversationId !== conversationId) return state;
            return { pending: false, status: "idle", conversationId: "", startedAt: 0 };
        }),
}));

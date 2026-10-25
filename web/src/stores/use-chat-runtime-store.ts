import { create } from "zustand";

export type ChatRuntimeStatus = "idle" | "starting" | "streaming" | "recovering" | "stopping";

type ChatRuntimeStore = {
    pending: boolean;
    status: ChatRuntimeStatus;
    conversationId: string;
    startedAt: number;
    userId: string;
    turnId: string;
    setRuntime: (patch: Partial<Pick<ChatRuntimeStore, "pending" | "status" | "conversationId" | "startedAt" | "userId" | "turnId">>) => void;
    clearRuntime: (conversationId?: string, turnId?: string) => void;
};

export const useChatRuntimeStore = create<ChatRuntimeStore>((set) => ({
    pending: false,
    status: "idle",
    conversationId: "",
    startedAt: 0,
    userId: "",
    turnId: "",
    setRuntime: (patch) => set(patch),
    clearRuntime: (conversationId, turnId) =>
        set((state) => {
            if (conversationId && state.conversationId !== conversationId) return state;
            if (turnId && state.turnId !== turnId) return state;
            return { pending: false, status: "idle", conversationId: "", startedAt: 0, userId: "", turnId: "" };
        }),
}));

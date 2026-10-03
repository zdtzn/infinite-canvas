import type { useAssetStore } from "@/stores/use-asset-store";

type CleanupAssetState = Pick<ReturnType<typeof useAssetStore.getState>, "hydrated" | "ownerUserId" | "syncStorageError" | "syncOutbox">;

export function getStorageCleanupBlockReason(state: CleanupAssetState, userId: string, expectedUserId = userId): string {
    if (!userId) return "请先登录，再清理文件。";
    if (userId !== expectedUserId) return "账号已切换，请重新打开存储管理后再清理文件。";
    if (state.syncStorageError) return `清理暂不可用：${state.syncStorageError}`;
    if (!state.hydrated) return "正在读取本机素材和待同步记录，读取完成后才能清理文件。";
    if (state.ownerUserId !== userId) return "当前账号的素材尚未准备好，请稍后再清理文件。";
    if (state.syncOutbox.some(entry => entry.userId === userId)) return "还有素材未完成云端同步，清理暂不可用。请先返回藏卷阁完成同步。";
    return "";
}

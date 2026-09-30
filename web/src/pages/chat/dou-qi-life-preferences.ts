type ChatMode = "chat" | "douqi";
const key = (userId: string, name: string) => `douqi:${encodeURIComponent(userId)}:${name}`;

export function readLifePreference(userId: string, name: string) {
    if (!userId) return "";
    try { return window.localStorage.getItem(key(userId, name)) || ""; } catch { return ""; }
}

export function writeLifePreference(userId: string, name: string, value: string) {
    if (!userId) return;
    try { window.localStorage.setItem(key(userId, name), value); } catch { /* Optional preference must not block play. */ }
}

export function readChatMode(userId: string): ChatMode {
    return readLifePreference(userId, "mode") === "douqi" ? "douqi" : "chat";
}

export function shouldSubmitLifeAction(event: { shiftKey: boolean; nativeEvent: { isComposing?: boolean; keyCode?: number } }) {
    return !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function usableLifeItems(state: import("@/services/dou-qi-life-api").DouQiLifeState) {
    return state.inventory.items.filter((item) => item.quantity > 0 && /丹药|疗伤|恢复/.test(`${item.category}${item.name}`));
}

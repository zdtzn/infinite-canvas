export const PROMPT_LIBRARY_UPDATED_EVENT = "infinite-canvas:prompt-library-updated";

export function notifyPromptLibraryUpdated() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PROMPT_LIBRARY_UPDATED_EVENT));
}

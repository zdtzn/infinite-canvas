import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

const getLocalStorage = (): Storage | null => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage || null;
    } catch {
        return null;
    }
};

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            const storage = getLocalStorage();
            if (!storage) return null;
            try {
                return storage.getItem(name);
            } catch {
                return null;
            }
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            const storage = getLocalStorage();
            if (!storage) return;
            try {
                storage.setItem(name, value);
            } catch {
                return;
            }
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            const storage = getLocalStorage();
            if (!storage) return;
            try {
                storage.removeItem(name);
            } catch {
                return;
            }
        }
    },
};

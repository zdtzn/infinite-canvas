import type { Config } from "@imgly/background-removal-node";

const DEFAULT_MODEL = "medium";

let removeBackgroundModulePromise: Promise<typeof import("@imgly/background-removal-node")> | undefined;

export async function removeBackgroundOnServer(source: Blob, onProgress?: Config["progress"]) {
    const { removeBackground } = await loadRemoveBackgroundModule();
    const result = await removeBackground(source, {
        publicPath: new URL("../node_modules/@imgly/background-removal-node/dist/", import.meta.url).toString(),
        model: resolveModel(),
        output: { format: "image/png", quality: 1 },
        progress: onProgress,
    });
    return result;
}

async function loadRemoveBackgroundModule() {
    removeBackgroundModulePromise ||= import("@imgly/background-removal-node");
    return removeBackgroundModulePromise;
}

function resolveModel(): "small" | "medium" {
    const value = String(process.env.CUTOUT_MODEL || DEFAULT_MODEL).trim().toLowerCase();
    return value === "small" ? "small" : "medium";
}

/** Empty mode preserves the request format of saved pre-mode configurations. */
export function resolveVideoMode(mode: string | undefined, imageCount: number, mediaCount = 0): "frames" | "reference" {
    return mode === "frames" && imageCount <= 2 && mediaCount === 0 ? "frames" : "reference";
}

export function videoImageLabel(mode: string | undefined, imageCount: number, index: number, mediaCount = 0) {
    return resolveVideoMode(mode, imageCount, mediaCount) === "frames" ? (index === 0 ? "首帧" : "尾帧") : `参考图 ${index + 1}`;
}

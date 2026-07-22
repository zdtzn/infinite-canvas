const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const DIMENSION_STEP = 16;

/** Convert the workbench's ratio presets to OpenAI-compatible pixel dimensions. */
export function resolveOpenAiImageSize(size?: string, quality?: string) {
    const value = String(size || "").trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    if (/^\d+x\d+$/i.test(value)) return value.toLowerCase();

    const match = value.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) return value;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return value;

    const longRatio = Math.max(width, height) / Math.min(width, height);
    const base = QUALITY_BASE[String(quality || "").trim().toLowerCase()];
    let longSide: number;
    let shortSide: number;
    if (base) {
        longSide = Math.floor(Math.sqrt(base * base * longRatio) / DIMENSION_STEP) * DIMENSION_STEP;
        shortSide = Math.round((longSide / longRatio) / DIMENSION_STEP) * DIMENSION_STEP;
    } else {
        shortSide = 1024;
        longSide = Math.round((shortSide * longRatio) / DIMENSION_STEP) * DIMENSION_STEP;
    }
    return width >= height ? `${longSide}x${shortSide}` : `${shortSide}x${longSide}`;
}

export function normalizeVideoSize(value: string, resolution = "720") {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value)) return value;
    const [width, height] = videoAspectRatio(value).split(":").map(Number);
    const shortEdge = Number(normalizeVideoResolution(resolution).replace(/p$/, "")) || 720;
    const scale = shortEdge / Math.min(width, height);
    return `${Math.max(2, Math.round((width * scale) / 2) * 2)}x${Math.max(2, Math.round((height * scale) / 2) * 2)}`;
}

export function videoAspectRatio(value: string) {
    if (!value || value === "auto") return "16:9";
    const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"];
    if (ratios.includes(value)) return value;
    const match = value.match(/^(\d+)[:x](\d+)$/);
    if (!match || !Number(match[1]) || !Number(match[2])) return "16:9";
    const target = Number(match[1]) / Number(match[2]);
    const ratio = (item: string) => {
        const [width, height] = item.split(":").map(Number);
        return width / height;
    };
    return ratios.reduce((best, item) => (Math.abs(ratio(item) - target) < Math.abs(ratio(best) - target) ? item : best));
}

export function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

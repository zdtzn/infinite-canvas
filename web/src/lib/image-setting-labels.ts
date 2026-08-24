import { normalizeImageSizeSelection } from "@/stores/use-config-store";

const imageSizeLabels: Record<string, string> = {
    "1:1": "方图 1:1",
    "5:4": "经典方幅 5:4",
    "4:5": "社媒竖图 4:5",
    "4:3": "标准横图 4:3",
    "3:4": "标准竖图 3:4",
    "3:2": "横图 3:2",
    "2:3": "海报 2:3",
    "16:9": "宽屏 16:9",
    "9:16": "手机竖图 9:16",
    "21:9": "电影宽屏 21:9",
    "9:21": "超长竖屏 9:21",
    "3:1": "超宽横幅 3:1",
    "1:3": "长竖幅 1:3",
    "4:1": "全景横幅 4:1",
    "1:4": "长卷竖幅 1:4",
    "8:1": "极宽全景 8:1",
    "1:8": "极长竖卷 1:8",
};

export function imageResolutionLabel(value: string) {
    return ({ auto: "自动", high: "4K", medium: "2K", low: "1K" } as Record<string, string>)[value] || value;
}

/** Kept for existing canvas summary callers; it represents output resolution. */
export function imageQualityLabel(value: string) {
    return imageResolutionLabel(value);
}

export function imageGenerationQualityLabel(value: string) {
    return ({ auto: "自动", low: "低", medium: "中", high: "高", standard: "标准", hd: "高清" } as Record<string, string>)[value] || value;
}

export function imageOutputFormatLabel(value: string) {
    return ({ auto: "自动", png: "PNG", jpeg: "JPEG", webp: "WebP" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    const normalizedSize = normalizeImageSizeSelection(size);
    return imageSizeLabels[normalizedSize] || normalizedSize;
}

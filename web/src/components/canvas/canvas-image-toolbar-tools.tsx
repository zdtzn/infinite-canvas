import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Grid2x2, Lock, LockOpen, Maximize2, Scissors, Sun, Upload, ZoomIn } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";

export type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "maskEdit" | "crop" | "split" | "upscale" | "angle" | "lighting" | "view";
export type ImageQuickToolId = "info" | "delete" | "saveAsset" | "download" | "edit" | ImageNodeActionToolId;

export type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onLighting: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

export type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    defaultVisible: boolean;
    panelLabel: string;
    label: string | ((node: CanvasNodeData) => string);
    title: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

export type ImageQuickToolsConfig = {
    ids: ImageQuickToolId[];
    showLabels: boolean;
    version: number;
};

type ImageQuickToolsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools";
export const IMAGE_QUICK_TOOLS_VERSION = 2;
const LEGACY_IMAGE_QUICK_TOOLS_STORAGE_KEYS = ["canvas-image-quick-tools-v7", "canvas-image-quick-tools-v6"];

const imageBaseToolIds: ImageQuickToolId[] = ["info", "delete", "saveAsset", "download", "edit"];
const defaultBaseToolIds: ImageQuickToolId[] = ["download", "edit"];

export const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        defaultVisible: false,
        panelLabel: "复制提示词",
        label: "复制提示词",
        title: "复制生成该图片的提示词",
        icon: () => <Copy className="size-4" />,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        defaultVisible: false,
        panelLabel: "反推提示词",
        label: "反推提示词",
        title: "创建反推提示词的文本和配置节点",
        icon: () => <FileText className="size-4" />,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        defaultVisible: false,
        panelLabel: "替换图片",
        label: "替换图片",
        title: "替换图片",
        icon: () => <Upload className="size-4" />,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        defaultVisible: false,
        panelLabel: "锁比例",
        label: (node) => (node.metadata?.freeResize ? "自由比例" : "锁比例"),
        title: (node) => (node.metadata?.freeResize ? "切换为等比缩放" : "切换为自由比例"),
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />),
        active: (node) => Boolean(node.metadata?.freeResize),
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "maskEdit",
        defaultVisible: false,
        panelLabel: "局部编辑",
        label: "局部编辑",
        title: "添加蒙版遮罩后局部修改",
        icon: () => <Brush className="size-4" />,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "crop",
        defaultVisible: false,
        panelLabel: "裁剪",
        label: "裁剪",
        title: "裁剪并生成新节点",
        icon: () => <Scissors className="size-4" />,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        defaultVisible: false,
        panelLabel: "切图",
        label: "切图",
        title: "按行列切分图片",
        icon: () => <Grid2x2 className="size-4" />,
        run: (node, handlers) => handlers.onSplit(node),
    },
    {
        id: "upscale",
        defaultVisible: false,
        panelLabel: "放大",
        label: "放大",
        title: "放大图片分辨率",
        icon: () => <ZoomIn className="size-4" />,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "angle",
        defaultVisible: false,
        panelLabel: "多角度",
        label: "多角度",
        title: "生成角度",
        icon: () => <Camera className="size-4" />,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "lighting",
        defaultVisible: true,
        panelLabel: "AI 打光",
        label: "打光",
        title: "调整主光方向、亮度与色温",
        icon: () => <Sun className="size-4" />,
        run: (node, handlers) => handlers.onLighting(node),
    },
    {
        id: "view",
        defaultVisible: true,
        panelLabel: "查看大图",
        label: "查看大图",
        title: "查看图片详情",
        icon: () => <Maximize2 className="size-4" />,
        run: (node, handlers) => handlers.onViewImage(node),
    },
];

export const defaultImageQuickToolIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolDefinitions.filter((tool) => tool.defaultVisible).map((tool) => tool.id)];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        title: resolveToolText(tool.title, node),
        icon: tool.icon(node),
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export function normalizeImageQuickToolIds(value: unknown[]) {
    const allIds: ImageQuickToolId[] = [...imageBaseToolIds, ...imageToolDefinitions.map((tool) => tool.id)];
    const ids = new Set(allIds);
    return allIds.filter((id) => value.includes(id) && ids.has(id));
}

export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig {
    if (Array.isArray(value)) return { ids: migrateImageQuickToolIds(normalizeImageQuickToolIds(value), 0), showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION };
    if (!value || typeof value !== "object") return { ids: defaultImageQuickToolIds, showLabels: false, version: IMAGE_QUICK_TOOLS_VERSION };
    const data = value as Partial<ImageQuickToolsConfig>;
    const version = Number.isInteger(data.version) ? Number(data.version) : 0;
    return {
        ids: Array.isArray(data.ids) ? migrateImageQuickToolIds(normalizeImageQuickToolIds(data.ids), version) : defaultImageQuickToolIds,
        showLabels: data.showLabels === true,
        version: IMAGE_QUICK_TOOLS_VERSION,
    };
}

export function imageQuickToolsStorageKey(userId: string) {
    return `${IMAGE_QUICK_TOOLS_STORAGE_KEY}:${encodeURIComponent(userId.trim() || "local")}`;
}

export function loadImageQuickToolsConfig(storage: ImageQuickToolsStorage | null | undefined, userId: string): { config: ImageQuickToolsConfig; configured: boolean } {
    const accountId = userId.trim();
    const storageKey = imageQuickToolsStorageKey(userId);
    const stored = readStorageValue(storage, storageKey);
    if (stored !== null) return { config: parseStoredImageQuickToolsConfig(storage, storageKey, stored), configured: true };

    for (const legacyKey of LEGACY_IMAGE_QUICK_TOOLS_STORAGE_KEYS) {
        const legacy = readStorageValue(storage, legacyKey);
        if (legacy === null) continue;
        const config = parseStoredImageQuickToolsConfig(storage, legacyKey, legacy);
        if (!accountId) return { config, configured: true };
        if (writeImageQuickToolsConfig(storage, userId, config)) {
            LEGACY_IMAGE_QUICK_TOOLS_STORAGE_KEYS.forEach((key) => removeStorageValue(storage, key));
        }
        return { config, configured: true };
    }

    return { config: readImageQuickToolsConfig(null), configured: false };
}

export function writeImageQuickToolsConfig(storage: ImageQuickToolsStorage | null | undefined, userId: string, value: ImageQuickToolsConfig) {
    try {
        storage?.setItem(imageQuickToolsStorageKey(userId), JSON.stringify(readImageQuickToolsConfig(value)));
        return Boolean(storage);
    } catch {
        return false;
    }
}

function parseStoredImageQuickToolsConfig(storage: ImageQuickToolsStorage | null | undefined, key: string, value: string) {
    try {
        return readImageQuickToolsConfig(JSON.parse(value) as unknown);
    } catch {
        removeStorageValue(storage, key);
        return readImageQuickToolsConfig(null);
    }
}

function readStorageValue(storage: ImageQuickToolsStorage | null | undefined, key: string) {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function removeStorageValue(storage: ImageQuickToolsStorage | null | undefined, key: string) {
    try {
        storage?.removeItem(key);
    } catch {
        // Browser privacy settings may disable local storage.
    }
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}

function migrateImageQuickToolIds(ids: ImageQuickToolId[], version: number) {
    if (version >= IMAGE_QUICK_TOOLS_VERSION || ids.includes("lighting")) return ids;
    const selected = new Set<ImageQuickToolId>([...ids, "lighting"]);
    const allIds: ImageQuickToolId[] = [...imageBaseToolIds, ...imageToolDefinitions.map((tool) => tool.id)];
    return allIds.filter((id) => selected.has(id));
}

import type { NavigateFunction } from "react-router-dom";

import { fetchPrompts } from "@/services/api/prompts";
import { uploadImage } from "@/services/image-storage";
import { imageAspectOptions, imageGenerationQualityOptions, imageOutputFormatOptions, imageResolutionOptions } from "@/components/image-settings-panel";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue, videoResolutionOptions, videoSecondOptions, videoSizeOptions } from "@/components/video-settings-panel";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, modelOptionName, normalizeImageSizeSelection, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

// 在网页端执行 Agent 的「站点级」工具（画布列表、工作台生成、提示词搜索、资产增删查等）。
// 这些工具的数据都在浏览器本地（localforage / zustand），因此由本模块直接读写对应 store 后返回结果。

export const SITE_TOOL_NAMES = [
    "canvas_list_projects",
    "generation_get_status",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
] as const;

export type SiteToolName = (typeof SITE_TOOL_NAMES)[number];

export function isSiteTool(name: string): name is SiteToolName {
    return (SITE_TOOL_NAMES as readonly string[]).includes(name);
}

export const SITE_TOOL_LABELS: Record<SiteToolName, string> = {
    canvas_list_projects: "画布列表",
    generation_get_status: "生成任务状态",
    workbench_image_get_config: "生图配置",
    workbench_image_generate: "生图工作台生成",
    workbench_video_get_config: "视频配置",
    workbench_video_generate: "视频创作台生成",
    prompts_search: "搜索提示词",
    assets_list: "资产列表",
    assets_add: "添加资产",
};

type SiteToolInput = Record<string, unknown>;
type SiteToolContext = { canvasSnapshot?: CanvasAgentSnapshot | null };
type GenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
type GenerationStatusItem = { id: string; source: "canvas" | "image" | "video"; status: GenerationStatus; kind?: string; title?: string; prompt?: string; projectId?: string; createdAt?: string; updatedAt?: string; successCount?: number; failCount?: number; error?: string };

export async function runSiteTool(name: SiteToolName, input: SiteToolInput, navigate: NavigateFunction, context: SiteToolContext = {}): Promise<unknown> {
    switch (name) {
        case "canvas_list_projects":
            return listCanvasProjects(input);
        case "generation_get_status":
            return getGenerationStatus(input, context.canvasSnapshot);
        case "workbench_image_get_config":
            return getImageConfig();
        case "workbench_image_generate":
            return runImageWorkbench(input, navigate);
        case "workbench_video_get_config":
            return getVideoConfig();
        case "workbench_video_generate":
            return runVideoWorkbench(input, navigate);
        case "prompts_search":
            return searchPrompts(input);
        case "assets_list":
            return listAssets(input);
        case "assets_add":
            return addAsset(input);
        default:
            throw new Error(`未知工具：${name}`);
    }
}

function getGenerationStatus(input: SiteToolInput, canvasSnapshot?: CanvasAgentSnapshot | null) {
    const scope = input.scope === "canvas" || input.scope === "image" || input.scope === "video" ? input.scope : "all";
    const taskId = typeof input.taskId === "string" ? input.taskId : "";
    const nodeIds = new Set(Array.isArray(input.nodeIds) ? input.nodeIds.filter((id): id is string => typeof id === "string") : []);
    const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit)) || 20));
    const tasks: GenerationStatusItem[] = [];
    const includeCanvas = (scope === "all" || scope === "canvas") && (!taskId || nodeIds.size > 0);
    const includeWorkbench = !nodeIds.size || Boolean(taskId);

    if (includeCanvas && canvasSnapshot) {
        canvasSnapshot.nodes.forEach((node) => {
            const status = normalizeCanvasGenerationStatus(node.metadata?.status);
            if (!status || (nodeIds.size && !nodeIds.has(node.id))) return;
            const metadata = node.metadata || {};
            if (!nodeIds.size && node.type !== "config" && status !== "running" && status !== "failed" && !metadata.generationMode && !metadata.generationType && !metadata.model) return;
            tasks.push({ id: node.id, source: "canvas", status, kind: metadata.generationMode || node.type, title: node.title, prompt: compactPrompt(metadata.prompt || metadata.composerContent), projectId: canvasSnapshot.projectId, error: metadata.errorDetails });
        });
    }

    if (includeWorkbench) {
        useWorkbenchAgentStore.getState().tasks.forEach((task) => {
            if ((scope === "image" || scope === "video") && task.kind !== scope) return;
            if (scope === "canvas" || (taskId && task.id !== taskId)) return;
            tasks.push({ ...task, source: task.kind, prompt: compactPrompt(task.prompt) });
        });
    }

    tasks.sort((a, b) => generationStatusOrder(a.status) - generationStatusOrder(b.status) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const summary: Record<GenerationStatus, number> = { idle: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
    tasks.forEach((task) => (summary[task.status] += 1));
    return { total: tasks.length, summary, tasks: tasks.slice(0, limit) };
}

function generationStatusOrder(status: GenerationStatus) {
    return status === "running" ? 0 : status === "queued" ? 1 : 2;
}

function normalizeCanvasGenerationStatus(status: unknown): GenerationStatus | null {
    if (status === "idle") return "idle";
    if (status === "loading") return "running";
    if (status === "success") return "succeeded";
    if (status === "error") return "failed";
    return null;
}

function compactPrompt(prompt: unknown) {
    const value = typeof prompt === "string" ? prompt.trim() : "";
    return value ? `${value.slice(0, 200)}${value.length > 200 ? "..." : ""}` : undefined;
}

function listCanvasProjects(input: SiteToolInput) {
    const { projects, hydrated } = useCanvasStore.getState();
    if (!hydrated) throw new Error("画布还在加载中，请稍后重试");
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const filtered = keyword ? projects.filter((project) => project.title.toLowerCase().includes(keyword)) : projects;
    const { page, pageSize, start, end } = paginate(input, filtered.length, 20);
    const items = filtered.slice(start, end).map((project) => ({
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        nodeCount: project.nodes.length,
        connectionCount: project.connections.length,
    }));
    return { total: filtered.length, page, pageSize, items, hint: "用 site_navigate 跳转 /canvas/{id} 打开对应画布" };
}

function getImageConfig() {
    const { config } = useConfigStore.getState();
    const model = config.imageModel || config.model;
    const resolved = resolveImageModelSettings(config, model);
    const current = resolved.config;
    return {
        current: { model: current.imageModel, modelName: modelOptionName(current.imageModel), resolution: current.quality, quality: current.imageQuality, outputFormat: current.imageOutputFormat, size: current.size, count: current.count, background: current.background || "opaque" },
        models: selectableModelsByCapability(config, "image").map((value) => ({ value, label: modelOptionLabel(config, value) })),
        resolutionOptions: resolved.capabilities.resolutions.map((value) => imageResolutionOptions.find((item) => item.value === value) || { value, label: value === "auto" ? "自动" : value }),
        qualityOptions: imageGenerationQualityOptions.filter((item) => resolved.capabilities.generationQualities.includes(item.value)),
        outputFormatOptions: imageOutputFormatOptions,
        sizeOptions: imageAspectOptions.filter((item) => resolved.capabilities.sizes.includes(item.value)),
        customSize: resolved.capabilities.customSize,
        transparentBackground: resolved.capabilities.transparentBackground,
        referenceLimit: resolved.capabilities.maxReferences,
        countRange: { min: 1, max: resolved.capabilities.maxOutputs },
    };
}

function runImageWorkbench(input: SiteToolInput, navigate: NavigateFunction) {
    const configStore = useConfigStore.getState();
    const candidate = { ...configStore.config };
    if (typeof input.model === "string" && input.model.trim()) {
        const value = normalizeModelOptionValue(input.model, configStore.config.channels) || input.model;
        candidate.imageModel = value;
    }
    if (typeof input.resolution === "string" && input.resolution.trim()) {
        candidate.quality = input.resolution;
    }
    if (typeof input.quality === "string" && input.quality.trim()) {
        candidate.imageQuality = input.quality;
    }
    if (typeof input.outputFormat === "string" && input.outputFormat.trim()) {
        candidate.imageOutputFormat = input.outputFormat;
    }
    if (typeof input.size === "string" && input.size.trim()) {
        candidate.size = normalizeImageSizeSelection(input.size);
    }
    if (input.count != null) {
        candidate.count = String(Math.max(1, Math.floor(Number(input.count)) || 1));
    }
    const selectedModel = candidate.imageModel || candidate.model;
    const resolved = resolveImageModelSettings(candidate, selectedModel).config;
    configStore.updateConfig("imageModel", resolved.imageModel);
    configStore.updateConfig("quality", resolved.quality);
    configStore.updateConfig("imageQuality", resolved.imageQuality);
    configStore.updateConfig("imageOutputFormat", resolved.imageOutputFormat);
    configStore.updateConfig("size", resolved.size);
    configStore.updateConfig("count", resolved.count);
    configStore.updateConfig("background", resolved.background);
    const applied = { model: resolved.imageModel, resolution: resolved.quality, quality: resolved.imageQuality, outputFormat: resolved.imageOutputFormat, size: resolved.size, count: resolved.count, background: resolved.background || "opaque" };
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    navigate("/image");
    const taskId = useWorkbenchAgentStore.getState().dispatchImage({ prompt, run });
    return { ok: true, navigated: "/image", prompt, run, taskId, applied, note: run ? "已跳转生图工作台并触发生成，可用 generation_get_status 查询任务" : "已跳转生图工作台并填入参数，未触发生成" };
}

function getVideoConfig() {
    const { config } = useConfigStore.getState();
    const model = config.videoModel || config.model;
    const selectedConfig = { ...config, model, videoModel: model };
    const seedance = isSeedanceVideoConfig(selectedConfig);
    return {
        current: {
            model,
            modelName: modelOptionName(model),
            size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSizeValue(config.size),
            seconds: seedance ? String(normalizeSeedanceDuration(config.videoSeconds)) : config.videoSeconds || "6",
            resolution: seedance ? normalizeSeedanceResolution(config.vquality, modelOptionName(model)) : normalizeVideoResolutionValue(config.vquality),
            generateAudio: seedance ? config.videoGenerateAudio !== "false" : undefined,
            watermark: seedance ? config.videoWatermark === "true" : undefined,
        },
        models: selectableModelsByCapability(config, "video").map((value) => ({ value, label: modelOptionLabel(config, value) })),
        providerMode: seedance ? "seedance" : "standard",
        sizeOptions: seedance ? seedanceRatioOptions : videoSizeOptions,
        secondsOptions: seedance ? seedanceDurationOptions.map(String) : videoSecondOptions,
        resolutionOptions: seedance ? seedanceResolutionOptions : videoResolutionOptions,
        supportsGenerateAudio: seedance,
        supportsWatermark: seedance,
    };
}

function runVideoWorkbench(input: SiteToolInput, navigate: NavigateFunction) {
    const configStore = useConfigStore.getState();
    const candidate = { ...configStore.config };
    if (typeof input.model === "string" && input.model.trim()) {
        const value = normalizeModelOptionValue(input.model, configStore.config.channels) || input.model;
        candidate.videoModel = value;
    }
    const model = candidate.videoModel || candidate.model;
    const seedance = isSeedanceVideoConfig({ ...candidate, model, videoModel: model });
    if (typeof input.size === "string" && input.size.trim()) {
        candidate.size = seedance ? normalizeSeedanceRatio(input.size) : normalizeVideoSizeValue(input.size);
    }
    if (typeof input.seconds === "string" && input.seconds.trim()) {
        candidate.videoSeconds = seedance ? String(normalizeSeedanceDuration(input.seconds)) : String(Math.max(1, Math.min(20, Math.floor(Number(input.seconds)) || 6)));
    }
    if (typeof input.resolution === "string" && input.resolution.trim()) {
        candidate.vquality = seedance ? normalizeSeedanceResolution(input.resolution, modelOptionName(model)) : normalizeVideoResolutionValue(input.resolution);
    }
    if (seedance && typeof input.generateAudio === "boolean") {
        candidate.videoGenerateAudio = String(input.generateAudio);
    }
    if (seedance && typeof input.watermark === "boolean") {
        candidate.videoWatermark = String(input.watermark);
    }
    candidate.size = seedance ? normalizeSeedanceRatio(candidate.size) : normalizeVideoSizeValue(candidate.size);
    candidate.videoSeconds = seedance ? String(normalizeSeedanceDuration(candidate.videoSeconds)) : String(Math.max(1, Math.min(20, Math.floor(Number(candidate.videoSeconds)) || 6)));
    candidate.vquality = seedance ? normalizeSeedanceResolution(candidate.vquality, modelOptionName(model)) : normalizeVideoResolutionValue(candidate.vquality);
    configStore.updateConfig("videoModel", model);
    configStore.updateConfig("size", candidate.size);
    configStore.updateConfig("videoSeconds", candidate.videoSeconds);
    configStore.updateConfig("vquality", candidate.vquality);
    if (seedance) {
        configStore.updateConfig("videoGenerateAudio", candidate.videoGenerateAudio);
        configStore.updateConfig("videoWatermark", candidate.videoWatermark);
    }
    const applied = {
        model,
        size: candidate.size,
        seconds: candidate.videoSeconds,
        resolution: candidate.vquality,
        ...(seedance ? { generateAudio: candidate.videoGenerateAudio !== "false", watermark: candidate.videoWatermark === "true" } : {}),
    };
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    navigate("/video");
    const taskId = useWorkbenchAgentStore.getState().dispatchVideo({ prompt, run });
    return { ok: true, navigated: "/video", prompt, run, taskId, applied, note: run ? "已跳转视频创作台并触发生成，可用 generation_get_status 查询任务" : "已跳转视频创作台并填入参数，未触发生成" };
}

async function searchPrompts(input: SiteToolInput) {
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize)) || 20));
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const result = await fetchPrompts({ keyword: String(input.keyword || ""), category: String(input.category || "全部"), tag: tags, page, pageSize });
    return {
        total: result.total,
        page,
        pageSize,
        categories: result.categories,
        tags: result.tags.slice(0, 60),
        items: result.items.map((prompt) => ({ id: prompt.id, title: prompt.title, prompt: prompt.prompt, category: prompt.category, tags: prompt.tags, coverUrl: prompt.coverUrl, githubUrl: prompt.githubUrl })),
    };
}

function listAssets(input: SiteToolInput) {
    const { assets, hydrated } = useAssetStore.getState();
    if (!hydrated) throw new Error("资产还在加载中，请稍后重试");
    const kind = input.kind === "text" || input.kind === "image" || input.kind === "video" ? input.kind : "all";
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const filtered = assets.filter((asset) => {
        if (kind !== "all" && asset.kind !== kind) return false;
        if (!keyword) return true;
        return [asset.title, asset.note, asset.source, ...asset.tags].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
    const { page, pageSize, start, end } = paginate(input, filtered.length, 20);
    const items = filtered.slice(start, end).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        tags: asset.tags,
        source: asset.source,
        note: asset.note,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        coverUrl: asset.coverUrl || undefined,
        content: asset.kind === "text" ? asset.data.content : undefined,
    }));
    return { total: filtered.length, page, pageSize, items };
}

async function addAsset(input: SiteToolInput) {
    const kind = input.kind;
    const title = String(input.title || "").trim();
    if (!title) throw new Error("请提供资产标题 title");
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const source = typeof input.source === "string" ? input.source : "Agent";
    const note = typeof input.note === "string" ? input.note : undefined;
    const store = useAssetStore.getState();
    if (kind === "text") {
        const content = String(input.content || "").trim();
        if (!content) throw new Error("kind=text 时需要提供 content 文本内容");
        const id = store.addAsset({ kind: "text", title, coverUrl: "", tags, source, note, data: { content } });
        return { ok: true, id, kind: "text" };
    }
    if (kind === "image") {
        const imageUrl = String(input.imageUrl || "").trim();
        if (!imageUrl) throw new Error("kind=image 时需要提供 imageUrl（图片地址或 dataURL）");
        let stored;
        try {
            stored = await uploadImage(imageUrl);
        } catch {
            throw new Error("无法读取该图片地址，请改用 dataURL 或可跨域访问的图片链接");
        }
        const id = store.addAsset({
            kind: "image",
            title,
            coverUrl: stored.thumbnailUrl || stored.url,
            tags,
            source,
            note,
            data: {
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                thumbnailKey: stored.thumbnailKey,
                thumbnailUrl: stored.thumbnailUrl,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        });
        return { ok: true, id, kind: "image" };
    }
    throw new Error("assets_add 仅支持 kind=text 或 kind=image");
}

function paginate(input: SiteToolInput, total: number, defaultSize: number) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize)) || defaultSize));
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(maxPage, Math.max(1, Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return { page, pageSize, start, end: start + pageSize };
}

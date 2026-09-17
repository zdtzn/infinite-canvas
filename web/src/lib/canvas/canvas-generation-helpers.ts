import { defaultConfig, normalizeImageSizeSelection, resolveModelForCapability, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { CanvasImageLightingParams } from "@/components/canvas/canvas-node-lighting-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image) return node;
            if (node.metadata?.storageKey) {
                const [resolvedContent, resolvedThumbnail] = await Promise.all([
                    resolveImageUrl(node.metadata.storageKey, content || ""),
                    node.metadata.thumbnailKey ? resolveImageUrl(node.metadata.thumbnailKey, node.metadata.thumbnailUrl) : Promise.resolve(node.metadata.thumbnailUrl),
                ]);
                return { ...node, metadata: { ...node.metadata, content: resolvedContent, ...(resolvedThumbnail ? { thumbnailUrl: resolvedThumbnail } : {}) } };
            }
            if (!content) return node;
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const size = node?.metadata?.size || config.size || defaultConfig.size;
    const generationConfig = {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        imageQuality: node?.metadata?.imageQuality ?? config.imageQuality ?? defaultConfig.imageQuality,
        imageOutputFormat: node?.metadata?.imageOutputFormat ?? config.imageOutputFormat ?? defaultConfig.imageOutputFormat,
        size: mode === "image" ? normalizeImageSizeSelection(size) : size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
    return mode === "image" ? resolveImageModelSettings(generationConfig, generationConfig.model).config : generationConfig;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading" && !node.metadata.jobId && !node.metadata.videoTask ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新前任务尚未提交到服务端，请重新生成。" } } : node,
    );
}

export function canvasVideoTaskBinding(config: AiConfig, model: string) {
    const resolved = resolveModelRequestConfig(config, model);
    return { channelId: resolved.channelId, baseUrl: resolved.baseUrl, apiFormat: resolved.apiFormat, channelMode: config.channelMode };
}

export function assertCanvasVideoTaskOwner(metadata: CanvasNodeMetadata, config: AiConfig, userId: string) {
    const task = metadata.videoTask;
    const binding = metadata.videoTaskBinding;
    if (!task || task.ownerUserId !== userId) throw new Error("视频任务属于其他账户，无法恢复");
    if (!binding || !config.channels.some((channel) => channel.id === binding.channelId)) throw new Error("原视频渠道已不可用，无法恢复任务");
    const current = canvasVideoTaskBinding(config, task.model);
    if (current.channelId !== binding.channelId || current.baseUrl !== binding.baseUrl || current.apiFormat !== binding.apiFormat || current.channelMode !== binding.channelMode) throw new Error("视频渠道配置已变化，请恢复原渠道后获取结果");
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `右侧视角 ${params.horizontalAngle} 度` : `左侧视角 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    const framing = params.cameraDistance <= 3 ? "近景" : params.cameraDistance >= 8 ? "远景" : "中景";
    return `AI 多角度：${horizontal}，${pitch}，${framing}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return [
        "基于参考图重新生成同一主体的新视角，不要只做平面透视变形。以原图视角为正面基准，左右方向指相机移至画面左侧或右侧观察主体，正俯仰为俯视，负俯仰为仰视。",
        "保持主体身份、数量、形状比例、颜色、材质和画面风格一致，不要增删或替换商品。",
        params.target === "subject" ? "仅调整主体或商品的可见朝向，呈现指定相机方位下的样子；多个主体一同调整，尽量保留海报其他元素与排版，不要把整张海报当作一块平板旋转。" : "相机绕主体移动，整体场景随视角自然变化，维持合理的空间透视关系。",
        params.preserveText ? "尽量逐字保留原有文字、包装标签和 Logo 的内容与设计，仅随所在表面产生合理透视，不得编造、改写或新增文字。" : "文字与 Logo 可随新构图自然调整。",
        params.preserveBackground ? "保留原背景中的元素、内容与风格，不替换背景；允许随视角变化产生必要的透视与遮挡。" : "背景可随新视角自然重构，保持原画面风格。",
        params.cameraDistance <= 3 ? "近景：突出主体细节，避免裁掉关键标识。" : params.cameraDistance >= 8 ? "远景：完整展示主体并增加环境留白。" : "中景：完整展示主体，保留适量环境。",
        params.wideAngle ? "使用广角视野和自然空间纵深，避免鱼眼及主体过度畸变。" : "使用标准镜头的自然透视，避免夸张畸变。",
        `${buildAngleLabel(params)}。未展示的表面仅作合理推测，不添加无依据的品牌标识。`,
    ].join(" ");
}

const lightingDirectionLabels: Record<CanvasImageLightingParams["direction"], string> = {
    front: "前方顺光",
    left: "左侧主光",
    top: "顶部主光",
    back: "后方逆光",
    right: "右侧主光",
    bottom: "底部主光",
};

export function buildLightingLabel(params: CanvasImageLightingParams) {
    return `AI 打光：${lightingDirectionLabels[params.direction]}，亮度 ${params.brightness}%，色温 ${params.temperature}K`;
}

export function buildLightingPrompt(params: CanvasImageLightingParams) {
    const mode = params.mode === "perspective" ? "按照场景透视、主体体积和空间深度建立自然光照层次" : "采用正面布光，光线覆盖均匀但保留自然立体感";
    const brightness = params.brightness < 35 ? "低亮度、克制柔和" : params.brightness < 65 ? "中等亮度、明暗平衡" : params.brightness < 85 ? "明亮清晰、对比自然" : "高亮度、冲击力较强但高光不过曝";
    const temperature = params.temperature < 3800 ? "偏暖的金橙色光线" : params.temperature > 6200 ? "偏冷的蓝白色光线" : "中性的自然白光";
    const horizontal = Math.round(params.lightPosition.x * 100);
    const vertical = Math.round(params.lightPosition.y * 100);
    const position = describeLightingPosition(params.lightPosition);
    return `基于参考图进行专业 AI 重打光。严格保持原图主体身份、产品外观、姿态、构图、镜头、文字内容、背景结构和画面比例，不新增或删除元素，不改变材质与原有设计。主光使用${lightingDirectionLabels[params.direction]}，光源相对主体位于${position}，水平偏移 ${horizontal}%，垂直偏移 ${vertical}%；${mode}。整体为${brightness}，色温 ${params.temperature}K，呈现${temperature}。重塑合理的高光、阴影、轮廓光和环境反射，使光影方向一致、边缘干净、过渡自然，避免死黑阴影、过曝、光晕污染和主体变形。`;
}

function describeLightingPosition(position: CanvasImageLightingParams["lightPosition"]) {
    const horizontal = position.x < -0.2 ? "左" : position.x > 0.2 ? "右" : "";
    const vertical = position.y < -0.2 ? "上方" : position.y > 0.2 ? "下方" : "";
    if (!horizontal && !vertical) return "正前方中央";
    if (!vertical) return `${horizontal}侧`;
    return `${horizontal || "正"}${vertical}`;
}

import { nanoid } from "nanoid";
import { decodeChannelModel, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { VideoGenerationTask } from "@/services/api/video";

export type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};
export type VideoTaskPhase = "queued" | "submitting" | "polling" | "paused" | "unknown" | "succeeded" | "failed" | "canceled";
export type VideoLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;
export type VideoSnapshot = { text: string; config: AiConfig; references: ReferenceImage[]; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[] };
export type VideoGenerationLog = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    ownerUserId?: string;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: VideoLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    phase?: VideoTaskPhase;
    trackingStopped?: boolean;
    agentTaskId?: string;
    connection?: { channelId: string; baseUrl: string; apiFormat: AiConfig["apiFormat"]; serverManaged: boolean };
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

// Persist generation settings and provider identity, never API keys or a mutable draft.
export function createVideoLog(input: VideoSnapshot, ownerUserId: string, agentTaskId?: string): VideoGenerationLog {
    const snapshot = structuredClone(input);
    const c = snapshot.config;
    const model = c.videoModel || c.model;
    const channel = resolveModelChannel(c, model);
    const now = Date.now();
    return {
        id: nanoid(),
        ownerUserId,
        createdAt: now,
        updatedAt: now,
        title: snapshot.text.slice(0, 40),
        prompt: snapshot.text,
        time: new Date(now).toLocaleString("zh-CN", { hour12: false }),
        model,
        config: { model, videoModel: model, size: c.size, vquality: c.vquality, videoSeconds: c.videoSeconds, videoGenerateAudio: c.videoGenerateAudio, videoWatermark: c.videoWatermark, videoMode: c.videoMode },
        references: snapshot.references,
        videoReferences: snapshot.videoReferences,
        audioReferences: snapshot.audioReferences,
        connection: { channelId: channel.id, baseUrl: channel.baseUrl, apiFormat: channel.apiFormat, serverManaged: channel.credentialState === "saved" },
        durationMs: 0,
        size: c.size,
        resolution: c.vquality,
        seconds: c.videoSeconds,
        status: "生成中",
        phase: "queued",
        agentTaskId,
    };
}

export function videoSnapshotFromLog(log: VideoGenerationLog, current: AiConfig): VideoSnapshot {
    const channelId = log.connection?.channelId || decodeChannelModel(log.model)?.channelId;
    const channel = current.channels.find((item) => (channelId ? item.id === channelId : item.models.some((model) => model.name === log.model)));
    if (!channel) throw new Error("原视频渠道已不可用，请恢复该渠道后继续查询或重试");
    if (log.connection && (log.connection.serverManaged !== (channel.credentialState === "saved") || (!log.connection.serverManaged && (log.connection.baseUrl !== channel.baseUrl || log.connection.apiFormat !== channel.apiFormat)))) {
        throw new Error("原视频渠道配置已变更，请恢复原接口配置后继续");
    }
    return structuredClone({
        text: log.prompt,
        config: { ...current, ...log.config, model: log.task?.model || log.model, videoModel: log.task?.model || log.model, channels: [channel], channelMode: "local" },
        references: log.references,
        videoReferences: log.videoReferences,
        audioReferences: log.audioReferences,
    });
}

export function videoTaskPhase(log: VideoGenerationLog): VideoTaskPhase {
    return log.phase || (log.status === "成功" ? "succeeded" : log.status === "失败" ? "failed" : log.task ? "polling" : "unknown");
}
export function isActiveVideoTask(log: VideoGenerationLog) {
    return ["queued", "submitting", "polling"].includes(videoTaskPhase(log));
}
export function videoTaskLabel(log: VideoGenerationLog) {
    if (log.phase === "submitting" && log.trackingStopped) return "等待任务编号（已停止查询）";
    return { queued: log.task ? "等待查询" : "排队中", submitting: "提交中", polling: "生成中", paused: "已停止查询", unknown: "创建结果未确认", succeeded: "已完成", failed: "生成失败", canceled: "已移出队列" }[videoTaskPhase(log)];
}

export function videoDownloadName(log: VideoGenerationLog) {
    const ext = log.video?.mimeType.split("/")[1]?.split(";")[0] || "mp4";
    const slug =
        log.prompt
            .trim()
            .slice(0, 40)
            .replace(/\s+/g, "_")
            .replace(/[^\w一-鿿-]/g, "") || "video";
    return `${slug}_${new Date(log.createdAt).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${["mp4", "webm", "mov", "avi"].includes(ext) ? ext : "mp4"}`;
}

export function videoAssetFromLog(log: VideoGenerationLog) {
    if (!log.video) throw new Error("视频结果尚未就绪");
    const video = log.video;
    return {
        kind: "video" as const,
        title: log.title || "生成视频",
        coverUrl: "",
        tags: [],
        source: "视频创作台",
        data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
        metadata: structuredClone({ source: "video-page", historyId: log.id, prompt: log.prompt, model: log.model, config: log.config, references: log.references, videoReferences: log.videoReferences, audioReferences: log.audioReferences }),
    };
}

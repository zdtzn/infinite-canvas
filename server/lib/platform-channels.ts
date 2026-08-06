import type { ChannelCapability, ChannelModelRecord, ChannelRecord, ServerState } from "../types";

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];
const CAPABILITIES = new Set<ChannelCapability>(["image", "video", "text", "audio"]);

export function platformChannelKey(adminUserId: string, channelId: string) {
  return `${adminUserId}:${channelId}`;
}

export function listPlatformChannels(state: ServerState) {
  const adminUserId = state.auth.adminUserId;
  if (!adminUserId) return [];
  const channels = Object.values(state.channels).filter((channel) => channel.userId === adminUserId);
  const legacyOrder = new Map(
    [...channels]
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .map((channel, index) => [channel.id, index]),
  );
  return channels
    .map((channel) => ({ ...channel, models: platformChannelModels(state, channel.id) }))
    .sort(
      (left, right) =>
        channelSortOrder(left.sortOrder, legacyOrder.get(left.id) || 0) - channelSortOrder(right.sortOrder, legacyOrder.get(right.id) || 0) ||
        left.name.localeCompare(right.name, "zh-CN"),
    );
}

export function resolvePlatformChannel(state: ServerState, channelId: string) {
  const adminUserId = state.auth.adminUserId;
  if (!adminUserId) return undefined;
  return state.channels[platformChannelKey(adminUserId, channelId)];
}

export function platformChannelModels(state: ServerState, channelId: string) {
  const channel = resolvePlatformChannel(state, channelId);
  return channel ? channelModels(state, channel) : [];
}

export function platformChannelPublicRecord(channel: ChannelRecord & { models: ChannelModelRecord[] }) {
  const { apiKey: _apiKey, userId: _userId, promptOptimizationModel: _promptOptimizationModel, ...publicChannel } = channel;
  return { ...publicChannel, hasApiKey: true };
}

export type PlatformPromptOptimizationTarget = { channelId: string; model: string };

export function platformPromptOptimizationTarget(state: ServerState): PlatformPromptOptimizationTarget | null {
  const adminUserId = state.auth.adminUserId;
  if (!adminUserId) return null;
  for (const channel of listPlatformChannels(state)) {
    const model = String(channel.promptOptimizationModel || "").trim();
    if (model && channel.models.some((item) => item.name === model && item.capability === "text")) return { channelId: channel.id, model };
  }
  return null;
}

export function setPlatformPromptOptimizationTarget(state: ServerState, target: PlatformPromptOptimizationTarget | null, updatedAt = Date.now()) {
  const adminUserId = state.auth.adminUserId;
  if (!adminUserId) return false;
  if (target) {
    const allowed = platformChannelModels(state, target.channelId).some((model) => model.name === target.model && model.capability === "text");
    if (!allowed) return false;
  }

  for (const channel of Object.values(state.channels)) {
    if (channel.userId !== adminUserId) continue;
    const nextModel = target?.channelId === channel.id ? target.model : undefined;
    if (channel.promptOptimizationModel === nextModel) continue;
    if (nextModel) channel.promptOptimizationModel = nextModel;
    else delete channel.promptOptimizationModel;
    channel.updatedAt = updatedAt;
  }
  return true;
}

export function normalizeChannelModels(input: unknown): ChannelModelRecord[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const models: ChannelModelRecord[] = [];
  for (const item of input.slice(0, 500)) {
    const source: Record<string, unknown> = item && typeof item === "object" ? (item as Record<string, unknown>) : { name: item };
    const name = String(source.name || "").trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const requestedCapability = String(source.capability || "") as ChannelCapability;
    const capability = CAPABILITIES.has(requestedCapability) ? requestedCapability : guessModelCapability(name);
    models.push({
      name,
      capability,
      ...(capability === "image" ? { imageCapabilities: normalizeChannelImageCapabilities(source.imageCapabilities) } : {}),
    });
  }
  return models;
}

function channelModels(state: ServerState, channel: ChannelRecord) {
  const configured = normalizeChannelModels(channel.models);
  if (configured.length) return configured;
  return normalizeChannelModels(
    Object.values(state.jobs)
      .filter((job) => job.input.channelId === channel.id)
      .map((job) => ({ name: job.input.model, capability: guessModelCapability(job.input.model) })),
  );
}

function guessModelCapability(name: string): ChannelCapability {
  const value = name.toLowerCase();
  if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
  if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
  if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
  return "text";
}

export function normalizeChannelImageCapabilities(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  const mode = String(source.mode || "");
  if (!["auto", "conservative", "custom"].includes(mode)) return undefined;
  if (mode !== "custom") return { mode: mode as "auto" | "conservative" };

  const options = (value: unknown, allowed: string[], fallback: string[]) => {
    const normalized = Array.isArray(value) ? Array.from(new Set(value.map((item) => String(item).trim().toLowerCase()).filter((item) => allowed.includes(item)))) : [];
    return normalized.length ? normalized : fallback;
  };
  const sizes = Array.isArray(source.sizes)
    ? Array.from(new Set(source.sizes.map((item) => String(item).trim()).filter((item) => /^\d{1,3}:\d{1,3}$/.test(item)))).slice(0, 30)
    : [];
  const integer = (value: unknown, minimum: number, maximum: number, fallback: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
  };
  return {
    mode: "custom" as const,
    resolutions: options(source.resolutions, ["auto", "low", "medium", "high"], ["auto"]),
    generationQualities: options(source.generationQualities, ["auto", "low", "medium", "high", "standard", "hd"], ["auto"]),
    outputFormats: options(source.outputFormats, ["auto", "png", "jpeg", "webp"], ["auto"]),
    sizes: sizes.length ? sizes : ["1:1"],
    customSize: Boolean(source.customSize),
    transparentBackground: Boolean(source.transparentBackground),
    maxReferences: integer(source.maxReferences, 0, 16, 1),
    maxOutputs: integer(source.maxOutputs, 1, 10, 1),
  };
}

function channelSortOrder(value: unknown, fallback: number) {
  const sortOrder = Number(value);
  return Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : fallback;
}

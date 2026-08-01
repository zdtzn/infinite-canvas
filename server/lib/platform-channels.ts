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
    models.push({
      name,
      capability: CAPABILITIES.has(requestedCapability) ? requestedCapability : guessModelCapability(name),
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

function channelSortOrder(value: unknown, fallback: number) {
  const sortOrder = Number(value);
  return Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : fallback;
}

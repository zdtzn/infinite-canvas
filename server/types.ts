import type { QueueJob } from "./lib/job-queue";
import type { EncryptedSecret } from "./lib/crypto-store";
import type { ProviderProtocol } from "./lib/url-policy";

export type UserStatus = "NORMAL" | "DISABLED" | "BANNED";
export type UserRecord = {
  userId: string;
  displayName: string;
  admin?: boolean;
  createdAt: number;
  disabled?: boolean;
  status?: UserStatus;
  loginHash?: string;
  internalNote?: string;
  publicMessage?: string;
};
export type ChannelRecord = {
  id: string;
  userId: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderProtocol;
  apiKey: EncryptedSecret;
  updatedAt: number;
};
export type StoredProject = {
  project: Record<string, unknown>;
  revision: number;
  updatedAt: number;
};
export type ProjectTombstone = {
  revision: number;
  deletedAt: number;
};
export type StoredAsset = {
  key: string;
  userId: string;
  mimeType: string;
  bytes: number;
  createdAt: number;
};
export type StoredImageReference = {
  path: string;
  mimeType: string;
  bytes: number;
};
export type ImageJobInput = {
  userId: string;
  channelId: string;
  apiFormat: ProviderProtocol;
  model: string;
  prompt: string;
  count: number;
  /** Output resolution tier: low=1K, medium=2K, high=4K. */
  quality?: string;
  /** Upstream generation-quality option, separate from image dimensions. */
  imageQuality?: string;
  /** Preferred image encoding for providers that expose output_format. */
  imageOutputFormat?: string;
  size?: string;
  background?: string;
  references: Array<string | StoredImageReference>;
  mask?: string | StoredImageReference;
  source?: {
    route?: string;
    projectId?: string;
    nodeId?: string;
    label?: string;
  };
  upstream?: {
    provider: "uu-image";
    taskId: string;
    expiresAt?: string;
    status?: "pending" | "running" | "succeeded" | "failed" | "canceled" | "unknown";
  };
};
export type ImageJobImage = {
  id: string;
  dataUrl: string;
  bytes: number;
  durationMs: number;
  mimeType: string;
};
export type ImageJobOutput = {
  images: ImageJobImage[];
  successCount: number;
  failCount: number;
  durationMs: number;
};
export type StoredImageJob = QueueJob<ImageJobInput, ImageJobOutput>;
export type ServerState = {
  version: 1;
  auth: { accessCodeHash: string; sessionSecret: string; adminUserId: string };
  users: Record<string, UserRecord>;
  channels: Record<string, ChannelRecord>;
  assets: Record<string, StoredAsset>;
  jobs: Record<string, StoredImageJob>;
  projects: Record<string, Record<string, StoredProject>>;
  projectTombstones: Record<string, Record<string, ProjectTombstone>>;
};

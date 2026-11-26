import type { ModelCapability } from "@/stores/use-config-store";
export type CallScript = { id: string; name: string; description: string; capability: ModelCapability; source: string; logo?: string; invertInDark?: boolean };

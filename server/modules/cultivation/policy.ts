export type PromotionPolicy = "auto" | "manual" | "boundary_manual";
export type ProgressStage = {
  id: string;
  realmId: string;
  order: number;
  requiredXp: number;
  promotionPolicy: PromotionPolicy;
};
export type ProgressState = {
  stageId: string;
  currentXp: number;
  pendingStageId: string | null;
};
export type ProgressTransition = {
  from: string;
  to: string;
  status: "automatic" | "pending";
};

export function advanceProgress(
  progress: ProgressState,
  stages: ProgressStage[],
) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  let stageId = progress.stageId;
  let currentXp = Math.max(0, progress.currentXp);
  let pendingStageId = progress.pendingStageId;
  const transitions: ProgressTransition[] = [];
  if (pendingStageId)
    return { stageId, currentXp, pendingStageId, transitions };

  for (;;) {
    const index = ordered.findIndex((stage) => stage.id === stageId);
    const stage = ordered[index];
    const next = ordered[index + 1];
    if (!stage || !next || currentXp < stage.requiredXp) break;
    const crossesRealm = stage.realmId !== next.realmId;
    const automatic =
      stage.promotionPolicy === "auto" ||
      (stage.promotionPolicy === "boundary_manual" && !crossesRealm);
    if (!automatic) {
      pendingStageId = next.id;
      transitions.push({ from: stage.id, to: next.id, status: "pending" });
      break;
    }
    currentXp -= stage.requiredXp;
    stageId = next.id;
    transitions.push({ from: stage.id, to: next.id, status: "automatic" });
  }
  return { stageId, currentXp, pendingStageId, transitions };
}

export function requiredCapabilityKeys(input: {
  model: string;
  quality?: string;
  references?: number;
  hasMask?: boolean;
  operation?: "standard" | "inpaint" | "outpaint";
}) {
  const keys = new Set<string>();
  const model = input.model.toLowerCase();
  if (input.quality === "high") keys.add("generation.hd");
  if (input.hasMask || input.operation === "inpaint")
    keys.add("generation.inpaint");
  if (input.operation === "outpaint") keys.add("generation.outpaint");
  if ((input.references || 0) > 0) keys.add("generation.references");
  if (
    model.includes("gpt-image") ||
    model.includes("dall-e") ||
    model.includes("dalle")
  )
    keys.add("model.gpt-image");
  if (model.includes("gemini")) keys.add("model.gemini");
  if (model.includes("flux")) keys.add("model.flux");
  return Array.from(keys).sort();
}

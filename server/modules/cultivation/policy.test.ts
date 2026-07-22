import { describe, expect, test } from "bun:test";

import {
  advanceProgress,
  requiredCapabilityKeys,
  type ProgressStage,
} from "./policy";

const stages: ProgressStage[] = [
  {
    id: "king-1",
    realmId: "king",
    order: 1,
    requiredXp: 100,
    promotionPolicy: "boundary_manual",
  },
  {
    id: "king-2",
    realmId: "king",
    order: 2,
    requiredXp: 120,
    promotionPolicy: "boundary_manual",
  },
  {
    id: "emperor-1",
    realmId: "emperor",
    order: 3,
    requiredXp: 200,
    promotionPolicy: "boundary_manual",
  },
];

describe("cultivation promotion policy", () => {
  test("automatically advances stars within the same realm and preserves overflow", () => {
    const result = advanceProgress(
      { stageId: "king-1", currentXp: 130, pendingStageId: null },
      stages,
    );

    expect(result).toEqual({
      stageId: "king-2",
      currentXp: 30,
      pendingStageId: null,
      transitions: [{ from: "king-1", to: "king-2", status: "automatic" }],
    });
  });

  test("requires approval at a realm boundary and keeps overflow experience", () => {
    const result = advanceProgress(
      { stageId: "king-2", currentXp: 175, pendingStageId: null },
      stages,
    );

    expect(result.stageId).toBe("king-2");
    expect(result.currentXp).toBe(175);
    expect(result.pendingStageId).toBe("emperor-1");
    expect(result.transitions).toEqual([
      { from: "king-2", to: "emperor-1", status: "pending" },
    ]);
  });

  test("manual policy requires approval for star upgrades", () => {
    const manualStages = stages.map((stage) => ({
      ...stage,
      promotionPolicy: "manual" as const,
    }));
    const result = advanceProgress(
      { stageId: "king-1", currentXp: 130, pendingStageId: null },
      manualStages,
    );

    expect(result.pendingStageId).toBe("king-2");
    expect(result.stageId).toBe("king-1");
  });

  test("derives capability keys from generation inputs", () => {
    expect(
      requiredCapabilityKeys({
        model: "gpt-image-1",
        quality: "high",
        references: 2,
        hasMask: true,
      }),
    ).toEqual([
      "generation.hd",
      "generation.inpaint",
      "generation.references",
      "model.gpt-image",
    ]);
  });
});

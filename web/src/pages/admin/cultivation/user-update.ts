export type CultivationUserFormValues = {
    stageId: string;
    currentXp?: number;
    xpDelta?: number;
    dailyLimitOverride?: number | null;
    unlimited?: boolean;
    status?: string;
    internalNote?: string;
    publicMessage?: string;
    reason: string;
};

export type CultivationUserPatch = Partial<Omit<CultivationUserFormValues, "reason">> & {
    reason: string;
};

const editableFields = [
    "stageId",
    "currentXp",
    "xpDelta",
    "dailyLimitOverride",
    "unlimited",
    "status",
    "internalNote",
    "publicMessage",
] as const;

export function buildCultivationUserPatch(initial: CultivationUserFormValues, current: CultivationUserFormValues): CultivationUserPatch {
    const patch: CultivationUserPatch = { reason: current.reason };
    const mutablePatch = patch as Record<string, unknown>;
    for (const field of editableFields) {
        if (!Object.is(initial[field], current[field])) mutablePatch[field] = current[field];
    }
    return patch;
}

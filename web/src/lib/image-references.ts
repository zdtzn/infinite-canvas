export function limitImageReferenceAdditions<TExisting, TAddition>(existing: TExisting[], additions: TAddition[], maxReferences: number) {
    const limit = Math.max(0, Math.floor(maxReferences) || 0);
    const available = Math.max(0, limit - existing.length);
    const accepted = additions.slice(0, available);
    return {
        items: [...existing, ...accepted] as Array<TExisting | TAddition>,
        accepted,
        added: accepted.length,
        rejected: Math.max(0, additions.length - accepted.length),
    };
}

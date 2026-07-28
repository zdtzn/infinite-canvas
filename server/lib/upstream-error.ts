export function readUpstreamErrorMessage(payload: unknown) {
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const error = asRecord(root?.error);
    return firstString(
        error?.message,
        error?.msg,
        typeof root?.error === "string" ? root.error : undefined,
        root?.message,
        root?.msg,
        root?.detail,
        data?.message,
        data?.msg,
        data?.detail,
    );
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

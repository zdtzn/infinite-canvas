export type ByteRange = { start: number; end: number };

export function parseSingleByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
    if (!value) return null;
    if (!Number.isSafeInteger(size) || size <= 0) return "invalid";
    const match = value.trim().match(/^bytes=(\d*)-(\d*)$/i);
    if (!match || (!match[1] && !match[2])) return "invalid";

    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
        return { start: Math.max(0, size - suffixLength), end: size - 1 };
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return "invalid";
    return { start, end: Math.min(requestedEnd, size - 1) };
}

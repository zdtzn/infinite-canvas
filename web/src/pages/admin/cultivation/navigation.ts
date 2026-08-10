export type AdminSectionKey = "overview" | "users" | "rules" | "capabilities" | "monitoring" | "records";
export type AdminRecordKind = "usage" | "ledger" | "audit-logs" | "login-logs" | "breakthroughs";

export function resolveAdminSection(value: string | null): AdminSectionKey {
    if (value === "users" || value === "overview" || value === "rules" || value === "capabilities" || value === "monitoring" || value === "records") return value;
    if (value === "config") return "rules";
    if (value === "usage") return "monitoring";
    if (value === "logs") return "records";
    return "overview";
}

export function resolveAdminRecordKind(value: string | null): AdminRecordKind {
    if (value === "ledger" || value === "audit-logs" || value === "login-logs" || value === "breakthroughs") return value;
    return "usage";
}

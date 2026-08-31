import { describe, expect, test } from "bun:test";

import { resolveAdminRecordKind, resolveAdminSection } from "./navigation";

describe("cultivation administrator navigation", () => {
    test("keeps the new section URLs stable", () => {
        expect(resolveAdminSection("overview")).toBe("overview");
        expect(resolveAdminSection("capabilities")).toBe("capabilities");
        expect(resolveAdminSection("announcements")).toBe("announcements");
        expect(resolveAdminSection("records")).toBe("records");
    });

    test("maps legacy tabs to the redesigned sections", () => {
        expect(resolveAdminSection("config")).toBe("rules");
        expect(resolveAdminSection("usage")).toBe("monitoring");
        expect(resolveAdminSection("logs")).toBe("records");
    });

    test("falls back to useful default views", () => {
        expect(resolveAdminSection(null)).toBe("overview");
        expect(resolveAdminSection("unknown")).toBe("overview");
        expect(resolveAdminRecordKind(null)).toBe("usage");
        expect(resolveAdminRecordKind("unknown")).toBe("usage");
    });
});

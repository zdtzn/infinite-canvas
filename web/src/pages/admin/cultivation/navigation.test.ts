import { describe, expect, test } from "bun:test";

import { resolveAdminRecordKind, resolveAdminSection } from "./navigation";

describe("cultivation administrator navigation", () => {
    test("keeps the new section URLs stable", () => {
        expect(resolveAdminSection("users")).toBe("users");
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

    test("opens user management for the root URL and invalid destinations", () => {
        expect(resolveAdminSection(null)).toBe("users");
        expect(resolveAdminSection("")).toBe("users");
        expect(resolveAdminSection("unknown")).toBe("users");
    });

    test("defaults record queries to generation usage", () => {
        expect(resolveAdminRecordKind(null)).toBe("usage");
        expect(resolveAdminRecordKind("unknown")).toBe("usage");
    });
});

import { describe, expect, test } from "bun:test";

import { canAccessUserAvatar } from "./avatar-access";

describe("user avatar access", () => {
    test("allows owners and administrators but rejects other users", () => {
        expect(canAccessUserAvatar("user-a", "user-a", false)).toBe(true);
        expect(canAccessUserAvatar("admin", "user-a", true)).toBe(true);
        expect(canAccessUserAvatar("user-b", "user-a", false)).toBe(false);
    });
});

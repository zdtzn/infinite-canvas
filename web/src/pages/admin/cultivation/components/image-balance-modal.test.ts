import { describe, expect, test } from "bun:test";

import { ServerRequestError, type CultivationProfile, type updateAdminImageBalance } from "@/services/server-api";
import { createImageBalanceIntentStore } from "./image-balance-modal";

const values = { imageBalance: 100, expectedImageBalance: 24, reason: " 补充次数 " };
const response = (paidImages: number) => ({ profile: { paidImages } as CultivationProfile });
type BalanceInput = Parameters<typeof updateAdminImageBalance>[1];

describe("administrator image balance intent lifecycle", () => {
    test("reopening an unknown adjustment reuses its fixed payload and ID even if a new draft is supplied", async () => {
        const store = createImageBalanceIntentStore();
        const sent: BalanceInput[] = [];
        const offline = async (_userId: string, input: BalanceInput) => {
            sent.push(input);
            throw new TypeError("offline");
        };
        await expect(store.submit("admin", "user", values, offline)).rejects.toThrow("offline");
        const restored = store.get("admin", "user");
        expect(restored).toMatchObject({ imageBalance: 100, expectedImageBalance: 24, reason: "补充次数" });
        expect(Object.isFrozen(restored)).toBe(true);
        await expect(store.submit("admin", "user", { imageBalance: 200, expectedImageBalance: 8, reason: "另一操作" }, offline)).rejects.toThrow("offline");
        expect(sent[1]).toBe(restored);
        expect(sent[1].adjustmentId).toBe(sent[0].adjustmentId);
    });

    test("isolates retained requests by both administrator and target user", async () => {
        const store = createImageBalanceIntentStore();
        const offline = async () => { throw new TypeError("offline"); };
        for (const [adminId, userId] of [["admin-a", "user-a"], ["admin-b", "user-a"], ["admin-a", "user-b"]]) {
            await expect(store.submit(adminId, userId, values, offline)).rejects.toThrow("offline");
        }
        const ids = [store.get("admin-a", "user-a"), store.get("admin-b", "user-a"), store.get("admin-a", "user-b")].map((input) => input?.adjustmentId);
        expect(new Set(ids).size).toBe(3);
        expect(store.get("admin-b", "user-b")).toBeUndefined();
        await expect(store.submit("", "user-a", values, offline)).rejects.toThrow("请重新登录");
    });

    test("releases a deterministic rejection so a confirmed new adjustment receives a new ID", async () => {
        const store = createImageBalanceIntentStore();
        let rejectedId = "";
        await expect(store.submit("admin", "user", values, async (_userId, input) => {
            rejectedId = input.adjustmentId;
            throw new ServerRequestError("次数已变化", 409);
        })).rejects.toThrow("次数已变化");
        expect(store.get("admin", "user")).toBeUndefined();
        await store.submit("admin", "user", { ...values, expectedImageBalance: 30 }, async (_userId, input) => {
            expect(input.adjustmentId).not.toBe(rejectedId);
            expect(input.expectedImageBalance).toBe(30);
            return response(100);
        });
        expect(store.get("admin", "user")).toBeUndefined();
    });

    test("retains HTTP timeout and server errors as unknown outcomes", async () => {
        const store = createImageBalanceIntentStore();
        for (const status of [408, 500, 502, 504]) {
            await expect(store.submit("admin", "user", values, async () => { throw new ServerRequestError("未确认", status); })).rejects.toThrow("未确认");
            expect(store.get("admin", "user")).toBeDefined();
        }
    });

    test("confirms an idempotent replay with the actual current balance after later usage", async () => {
        const store = createImageBalanceIntentStore();
        await expect(store.submit("admin", "user", values, async () => { throw new TypeError("response lost"); })).rejects.toThrow("response lost");
        const original = store.get("admin", "user");
        const result = await store.submit("admin", "user", values, async (_userId, input) => {
            expect(input).toBe(original);
            return response(97);
        });
        expect(result.profile.paidImages).toBe(97);
        expect(store.get("admin", "user")).toBeUndefined();
    });
});

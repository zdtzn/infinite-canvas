import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { ServerRequestError, type CultivationProfile, type updateAdminImageBalance } from "@/services/server-api";
import { openAppDatabase } from "../../../../../../server/db/database";
import { createCultivationService } from "../../../../../../server/modules/cultivation/service";
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
            throw new ServerRequestError("生图可用次数已变化，请刷新后重新调整", 409, undefined, "WALLET_BALANCE_CONFLICT");
        })).rejects.toThrow("生图可用次数已变化");
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

    test.each([401, 429])("keeps one ledger adjustment after a lost response, HTTP %i and usage back to the original balance", async (status) => {
        const dataDir = mkdtempSync(join(tmpdir(), "image-balance-retry-"));
        const database = openAppDatabase({ dataDir });
        try {
            database.raw!.exec("INSERT INTO users(user_id, display_name, created_at) VALUES ('admin', 'Admin', 1), ('user', 'User', 1)");
            const service = createCultivationService(database.raw!);
            service.ensureUser("user", false);
            database.raw!.exec("INSERT INTO wallet_balances(user_id, image_balance, updated_at) VALUES ('user', 24, 1)");
            const store = createImageBalanceIntentStore();
            const send = async (userId: string, input: BalanceInput) => ({ profile: service.setImageBalance("admin", userId, input) as CultivationProfile });
            await expect(store.submit("admin", "user", values, async (userId, input) => {
                await send(userId, input);
                throw new TypeError("response lost");
            })).rejects.toThrow("response lost");
            const original = store.get("admin", "user");
            await expect(store.submit("admin", "user", values, async () => {
                throw new ServerRequestError("前置拒绝", status);
            })).rejects.toThrow("前置拒绝");
            expect(store.get("admin", "user")).toBe(original);
            database.raw!.exec("UPDATE wallet_balances SET image_balance = 24 WHERE user_id = 'user'");
            const result = await store.submit("admin", "user", { ...values, imageBalance: 200, reason: "另一草稿" }, send);
            expect(result.profile.paidImages).toBe(24);
            expect(database.raw!.query("SELECT COUNT(*) AS total FROM wallet_ledger WHERE kind = 'admin_grant'").get()).toEqual({ total: 1 });
            expect(service.listAuditLogs().total).toBe(1);
            expect(store.get("admin", "user")).toBeUndefined();
        } finally {
            database.close();
            if (dirname(dataDir) === tmpdir() && basename(dataDir).startsWith("image-balance-retry-")) {
                try { rmSync(dataDir, { recursive: true, force: true }); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error; }
            }
        }
    });

    test.each([400, 401, 403, 404, 409, 422, 429])("allows correcting a first deterministic HTTP %i rejection", async (status) => {
        const store = createImageBalanceIntentStore();
        let originalId = "";
        await expect(store.submit("admin", "user", values, async (_userId, input) => {
            originalId = input.adjustmentId;
            throw new ServerRequestError("明确拒绝", status);
        })).rejects.toThrow("明确拒绝");
        expect(store.get("admin", "user")).toBeUndefined();
        await store.submit("admin", "user", { ...values, imageBalance: 101 }, async (_userId, input) => {
            expect(input.adjustmentId).not.toBe(originalId);
            expect(input.imageBalance).toBe(101);
            return response(101);
        });
    });

    test.each([400, 403, 404, 409, 422])("keeps an unknown adjustment after HTTP %i that does not establish its prior outcome", async (status) => {
        const store = createImageBalanceIntentStore();
        await expect(store.submit("admin", "user", values, async () => { throw new TypeError("response lost"); })).rejects.toThrow("response lost");
        const original = store.get("admin", "user");
        await expect(store.submit("admin", "user", values, async () => {
            throw new ServerRequestError(status === 409 ? "调整请求编号已用于其他操作" : "前置拒绝", status, undefined, status === 409 ? "WALLET_SOURCE_CONFLICT" : undefined);
        })).rejects.toThrow();
        expect(store.get("admin", "user")).toBe(original);
    });

    test("a matching conflict message without the balance conflict code cannot release an unknown adjustment", async () => {
        for (const code of [undefined, "WALLET_SOURCE_CONFLICT"]) {
            const store = createImageBalanceIntentStore();
            await expect(store.submit("admin", "user", values, async () => { throw new TypeError("response lost"); })).rejects.toThrow("response lost");
            const original = store.get("admin", "user");
            await expect(store.submit("admin", "user", values, async () => {
                throw new ServerRequestError("生图可用次数已变化，请刷新后重新调整", 409, undefined, code);
            })).rejects.toThrow("生图可用次数已变化");
            expect(store.get("admin", "user")).toBe(original);
        }
    });

    test("a replayed balance conflict code proves the original ID was not applied and permits a corrected adjustment", async () => {
        const store = createImageBalanceIntentStore();
        await expect(store.submit("admin", "user", values, async () => { throw new TypeError("response lost"); })).rejects.toThrow("response lost");
        const original = store.get("admin", "user");
        await expect(store.submit("admin", "user", values, async () => {
            throw new ServerRequestError("余额已更新", 409, "request-123456", "WALLET_BALANCE_CONFLICT");
        })).rejects.toThrow("余额已更新");
        expect(store.get("admin", "user")).toBeUndefined();
        await store.submit("admin", "user", { ...values, expectedImageBalance: 30 }, async (_userId, input) => {
            expect(input.adjustmentId).not.toBe(original?.adjustmentId);
            expect(input.expectedImageBalance).toBe(30);
            return response(100);
        });
    });
});

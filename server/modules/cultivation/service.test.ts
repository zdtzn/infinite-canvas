import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import type { ServerState } from "../../types";
import { CultivationError, createCultivationService } from "./service";

const directories: string[] = [];

afterEach(() => {
  while (directories.length) {
    try {
      rmSync(directories.pop()!, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
  }
});

describe("cultivation quota and settlement", () => {
  test("grants six registration images once and never replenishes them on restart or profile reads", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    expect(service.getWallet("user").balance).toBe(0);
    expect(service.grantRegistrationImages("user")).toBe(6);
    expect(service.grantRegistrationImages("user")).toBe(6);
    expect(service.getWallet("user").items[0]).toMatchObject({ kind: "registration_grant", delta: 6, sourceId: "registration" });
    service.reserveGeneration({ jobId: "registration-images", userId: "user", channelId: "channel", model: "gpt-image-1", count: 6, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
    service.settleGeneration({ jobId: "registration-images", successCount: 6, failCount: 0, durationMs: 10 });
    expect(service.grantRegistrationImages("user")).toBe(0);
    expect(service.getProfile("user")).toMatchObject({ dailyLimit: 0, remainingToday: 0, paidImages: 0, todaySuccessfulImages: 6 });
    store.close();
    const reopened = openAppDatabase({ dataDir });
    try {
      const restored = createCultivationService(reopened.raw!, { now: () => new Date("2026-07-23T08:00:00+08:00") });
      restored.ensureUser("user", false);
      expect(restored.grantRegistrationImages("user")).toBe(0);
      expect(restored.getProfile("user")).toMatchObject({ paidImages: 0, remainingToday: 0, todaySuccessfulImages: 0 });
      expect(restored.getWallet("user").items.filter((item: any) => item.kind === "registration_grant")).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  test("rolls registration credits back with account creation and leaves existing accounts unchanged", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.getProfile("user");
      createCultivationService(store.raw!).ensureUser("user", false);
      expect(service.getWallet("user").balance).toBe(0);
      expect(() => store.raw!.transaction(() => {
        store.raw!.query("INSERT INTO users(user_id, display_name, created_at) VALUES ('new-registration', 'New', 1)").run();
        service.ensureUser("new-registration", false);
        service.grantRegistrationImages("new-registration");
        throw new Error("registration failed");
      })()).toThrow("registration failed");
      expect(store.raw!.query("SELECT 1 FROM users WHERE user_id = 'new-registration'").get()).toBeNull();
      expect(store.raw!.query("SELECT 1 FROM wallet_balances WHERE user_id = 'new-registration'").get()).toBeNull();
      expect(store.raw!.query("SELECT 1 FROM wallet_ledger WHERE kind = 'registration_grant'").get()).toBeNull();
    } finally {
      store.close();
    }
  });

  test("ignores below-emperor realm quotas, old overrides and unlimited flags for image billing", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", true);
      service.grantWalletPackage("admin", "user", "qiling", "grant-policy", "测试图片计费政策");
      const realms = service.getConfiguration().realms;
      service.updateRealm("admin", realms.at(-2)!.id, { dailyLimit: null }, "非斗帝空额度不赠送图片");
      for (const [index, input] of [
        { stageId: realms[0].stages[0].id, dailyLimitOverride: null, unlimited: false },
        { stageId: realms[1].stages[0].id, dailyLimitOverride: 500, unlimited: false },
        { stageId: realms.at(-2)!.stages[0].id, dailyLimitOverride: null, unlimited: false },
        { stageId: realms[0].stages[0].id, dailyLimitOverride: 500, unlimited: true },
      ].entries()) {
        service.updateUser("admin", "user", input, "核对旧账号额度");
        expect(service.getProfile("user")).toMatchObject({ dailyLimit: 0, dailyLimitOverride: null, unlimited: false, remainingToday: 0 });
        service.reserveGeneration({ jobId: `policy-${index}`, userId: "user", channelId: "channel", model: "gpt-image-1", count: 1, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
        expect(store.raw!.query("SELECT free_count, paid_count FROM generation_usage WHERE job_id = ?").get(`policy-${index}`)).toEqual({ free_count: 0, paid_count: 1 });
      }
      expect(service.getWallet("user").balance).toBe(36);
      expect(service.getProfile("user").proxyQuota).toMatchObject({ dailyLimit: 500, dailyLimitOverride: 500, unlimited: true, remainingToday: null });
      expect(store.raw!.query("SELECT daily_limit_override, unlimited_quota FROM user_cultivation WHERE user_id = 'user'").get()).toEqual({ daily_limit_override: 500, unlimited_quota: 1 });
    } finally {
      store.close();
    }
  });

  test("unlocks unlimited image generation immediately at Dou Emperor without changing paid reservations", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-promotion", "升级前图片预占");
      const realms = service.getConfiguration().realms;
      const lastSaintStage = realms.at(-2)!.stages.at(-1)!;
      service.updateUser("admin", "user", { stageId: lastSaintStage.id, currentXp: 0, dailyLimitOverride: 0, unlimited: false }, "斗圣等待突破");
      const input = { jobId: "before-emperor", userId: "user", channelId: "channel", model: "gpt-image-1", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0 };
      service.reserveGeneration({ ...input, allowPaidImages: true });
      expect(service.getWallet("user").balance).toBe(38);
      service.updateUser("admin", "user", { currentXp: lastSaintStage.requiredXp }, "突破斗帝");
      expect(service.getProfile("user")).toMatchObject({ realmId: "realm-dou-emperor", dailyLimit: null, dailyLimitOverride: null, unlimited: true, remainingToday: null, paidImages: 38, proxyQuota: { dailyLimit: 0, unlimited: false, remainingToday: 0 } });
      service.reserveGeneration({ ...input, jobId: "after-emperor", count: 3 });
      expect(store.raw!.query("SELECT free_count, paid_count FROM generation_usage WHERE job_id = 'after-emperor'").get()).toEqual({ free_count: 3, paid_count: 0 });
      expect(service.getWallet("user").balance).toBe(38);
      service.settleGeneration({ jobId: "before-emperor", successCount: 2, failCount: 0, durationMs: 10 });
      service.settleGeneration({ jobId: "after-emperor", successCount: 2, failCount: 1, durationMs: 10 });
      expect(service.getProfile("user")).toMatchObject({ unlimited: true, remainingToday: null, paidImages: 38, todaySuccessfulImages: 4 });
      expect(service.getWallet("user").items.map((item: any) => item.delta)).toEqual([-2, 40]);
    } finally {
      store.close();
    }
  });

  test("preserves actual administrators' explicit unlimited and finite image quotas", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      expect(service.getProfile("admin")).toMatchObject({ dailyLimit: null, unlimited: true, remainingToday: null });
      service.reserveGeneration({ jobId: "admin-unlimited", userId: "admin", channelId: "channel", model: "gpt-image-1", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0 });
      service.refundGeneration("admin-unlimited", "管理员任务取消");
      service.updateUser("admin", "admin", { dailyLimitOverride: 1, unlimited: false }, "设定管理员有限额度");
      expect(service.getProfile("admin")).toMatchObject({ dailyLimit: 1, dailyLimitOverride: 1, unlimited: false, remainingToday: 1 });
      service.reserveGeneration({ jobId: "admin-finite", userId: "admin", channelId: "channel", model: "gpt-image-1", count: 1, referenceCount: 0, hasMask: false, activeJobs: 0 });
      service.settleGeneration({ jobId: "admin-finite", successCount: 1, failCount: 0, durationMs: 10 });
      expect(service.getProfile("admin")).toMatchObject({ remainingToday: 0, usedToday: 1, todaySuccessfulImages: 1, paidImages: 0 });
    } finally {
      store.close();
    }
  });

  test("rejects insufficient or unauthorized wallet reservations atomically", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-atomic", "测试原子扣款");
      const input = { jobId: "denied", userId: "user", channelId: "channel", model: "gpt-image-1", count: 1, referenceCount: 0, hasMask: false, activeJobs: 0 };
      expect(() => service.reserveGeneration(input)).toThrow("需要使用灵卷");
      service.reserveGeneration({ ...input, jobId: "accepted", count: 39, allowPaidImages: true });
      try {
        service.reserveGeneration({ ...input, count: 2, allowPaidImages: true });
        throw new Error("Expected insufficient-wallet rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CultivationError);
        expect(error).toMatchObject({ status: 402, code: "WALLET_INSUFFICIENT" });
        expect((error as Error).message).toContain("灵卷余额不足");
      }
      expect(service.getGenerationUsage("denied")).toBeNull();
      expect(service.getWallet("user").balance).toBe(1);
      expect(service.getWallet("user").total).toBe(2);
      expect(service.getProfile("user").proxyQuota.reservedToday).toBe(0);
      service.refundGeneration("accepted", "退款");
      service.refundGeneration("accepted", "重复退款");
      expect(service.getWallet("user").balance).toBe(40);
      expect(service.getWallet("user").total).toBe(3);
    } finally {
      store.close();
    }
  });

  test("keeps proxy budgets independent of image wallet billing and never charges proxies", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-proxy", "测试服务额度");
      service.updateUser("admin", "user", { dailyLimitOverride: 1 }, "服务额度覆盖");
      const input = { kind: "proxy" as const, jobId: "proxy-one", userId: "user", channelId: "channel", model: "video-model", count: 1, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true };
      service.reserveGeneration(input);
      expect(service.getProfile("user").proxyQuota).toMatchObject({ remainingToday: 0, reservedToday: 1 });
      expect(() => service.reserveGeneration({ ...input, jobId: "proxy-denied" })).toThrow("今日服务额度已经耗尽");
      expect(service.getGenerationUsage("proxy-denied")).toBeNull();
      service.consumeGeneration("proxy-one");
      expect(service.getProfile("user")).toMatchObject({ remainingToday: 0, usedToday: 1, todaySuccessfulImages: 0, proxyQuota: { dailyLimit: 1, usedToday: 1, reservedToday: 0 } });
      expect(service.getWallet("user").balance).toBe(40);
      expect(service.getWallet("user").total).toBe(1);
      service.updateUser("admin", "user", { unlimited: true }, "其他服务不限");
      service.reserveGeneration({ ...input, jobId: "proxy-unlimited", count: 5 });
      expect(service.getProfile("user").proxyQuota.remainingToday).toBeNull();
      expect(service.getWallet("user").balance).toBe(40);
    } finally {
      store.close();
    }
  });

  test("settles and refunds historical free and mixed reservations without retroactive charges", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-historical", "测试旧任务");
      const insert = store.raw!.query("INSERT INTO generation_usage(job_id, user_id, usage_date, model, channel_id, requested_count, free_count, paid_count, status, created_at) VALUES (?, 'user', '2026-07-21', 'gpt-image-1', 'channel', ?, ?, ?, 'reserved', 1)");
      insert.run("old-free", 2, 2, 0);
      insert.run("old-mixed", 3, 1, 2);
      insert.run("old-refund", 2, 2, 0);
      store.raw!.query("INSERT INTO daily_usage(user_id, usage_date, reserved_count) VALUES ('user', '2026-07-21', 5)").run();
      store.raw!.query("UPDATE wallet_balances SET image_balance = image_balance - 2 WHERE user_id = 'user'").run();
      store.raw!.query("INSERT INTO wallet_ledger(id, user_id, delta, balance_after, kind, source_id, created_at) VALUES ('old-reserve-ledger', 'user', -2, 38, 'reserve', 'old-mixed', 1)").run();
      service.settleGeneration({ jobId: "old-free", successCount: 1, failCount: 1, durationMs: 10 });
      service.settleGeneration({ jobId: "old-mixed", successCount: 2, failCount: 1, durationMs: 10 });
      service.refundGeneration("old-refund", "旧任务失败");
      service.settleGeneration({ jobId: "old-mixed", successCount: 2, failCount: 1, durationMs: 10 });
      expect(service.getWallet("user").balance).toBe(39);
      expect(service.getProfile("user")).toMatchObject({ dailyLimit: 0, remainingToday: 0, usedToday: 0, todaySuccessfulImages: 0, totalImages: 3 });
      expect(store.raw!.query("SELECT used_count, reserved_count, refunded_count, successful_images FROM daily_usage WHERE user_id = 'user' AND usage_date = '2026-07-21'").get()).toEqual({ used_count: 2, reserved_count: 0, refunded_count: 3, successful_images: 3 });
      expect(service.getWallet("user").items.filter((item: any) => item.kind === "refund")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("grants a package once and charges every successful ordinary-user image", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-request-1", "测试发放");
      service.grantWalletPackage("admin", "user", "qiling", "grant-request-1", "测试发放");
      expect(service.getWallet("user").balance).toBe(40);
      expect(service.getWallet("user").total).toBe(1);
      expect(() => service.grantWalletPackage("admin", "user", "juling", "grant-request-1", "重复用途")).toThrow();

      service.reserveGeneration({ jobId: "paid-job", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 9, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      service.settleGeneration({ jobId: "paid-job", successCount: 9, failCount: 0, durationMs: 100 });
      service.reserveGeneration({ jobId: "partial-job", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 4, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      expect(service.getProfile("user")).toMatchObject({ remainingToday: 0, paidImages: 27 });
      service.settleGeneration({ jobId: "partial-job", successCount: 2, failCount: 2, durationMs: 100 });
      expect(service.getProfile("user")).toMatchObject({ remainingToday: 0, paidImages: 29, totalImages: 11, todaySuccessfulImages: 11, usedToday: 0 });
      expect(service.getWallet("user").items.map((item: any) => item.delta)).toEqual([2, -4, -9, 40]);
      service.settleGeneration({ jobId: "partial-job", successCount: 2, failCount: 2, durationMs: 100 });
      expect(service.getWallet("user").balance).toBe(29);
    } finally {
      store.close();
    }
  });

  test("refunds paid reservations after failure and restart", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    service.grantWalletPackage("admin", "user", "qiling", "grant-request-2", "测试发放");
    service.reserveGeneration({ jobId: "failed-job", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
    expect(service.getWallet("user").balance).toBe(38);
    store.close();
    const reopened = openAppDatabase({ dataDir });
    try {
      const restored = createCultivationService(reopened.raw!, { now: () => new Date("2026-07-22T08:00:00+08:00") });
      expect(restored.reconcileReservations([])).toEqual(["failed-job"]);
      expect(restored.getWallet("user").balance).toBe(40);
      expect(restored.reconcileReservations([])).toEqual([]);
      expect(restored.getWallet("user").items.filter((item: any) => item.kind === "refund")).toHaveLength(1);
      expect(() => restored.reserveGeneration({ jobId: "unpaid-job", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 41, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true })).toThrow("灵卷余额不足");
      expect(restored.getWallet("user").balance).toBe(40);
    } finally {
      reopened.close();
    }
  });

  test("counts successful paid images without consuming free quota", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-paid-success", "测试发放");
      service.reserveGeneration({ jobId: "paid-success", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      service.settleGeneration({ jobId: "paid-success", successCount: 2, failCount: 0, durationMs: 100 });
      expect(service.getProfile("user")).toMatchObject({ usedToday: 0, paidImages: 38, totalImages: 2 });
      const usage = store.raw!.query("SELECT used_count, successful_images FROM daily_usage WHERE user_id = 'user'").get() as { used_count: number; successful_images: number };
      expect(usage).toMatchObject({ used_count: 0, successful_images: 2 });
      expect(service.getWallet("user").items.map((item: any) => item.delta)).toEqual([-2, 40]);
    } finally {
      store.close();
    }
  });

  test("returns paid images when a submitted job is canceled", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-canceled-job", "测试发放");
      service.updateUser("admin", "user", { dailyLimitOverride: 1 }, "测试取消生图");
      service.reserveGeneration({ jobId: "canceled-job", userId: "user", channelId: "channel", model: "gpt-image-2.5", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      expect(service.getWallet("user").balance).toBe(38);
      service.consumeGeneration("canceled-job", 100);
      service.consumeGeneration("canceled-job", 100);
      expect(service.getProfile("user")).toMatchObject({ usedToday: 0, paidImages: 40, todaySuccessfulImages: 0 });
      expect(service.getWallet("user").items.map((item: any) => item.delta)).toEqual([2, -2, 40]);
    } finally {
      store.close();
    }
  });

  test("uses a single terminal Dou Emperor stage", () => {
    const { store, service } = setup();
    try {
      const emperor = service
        .getConfiguration()
        .realms.find((realm) => realm.code === "dou-emperor");
      expect(emperor?.stages).toHaveLength(1);
      expect(emperor?.stages[0]?.name).toBe("斗帝");

      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      service.updateUser(
        "admin",
        "user",
        { stageId: emperor!.stages[0].id },
        "set terminal stage",
      );
      expect(service.getProfile("user").nextStageName).toBeNull();
    } finally {
      store.close();
    }
  });

  test("hides the retired peak Dou Zun realm from configuration", () => {
    const { store, service } = setup();
    try {
      store
        .raw!.query(
          "INSERT INTO realms(id, theme_key, code, name, color, icon_key, animation_preset, sort_order, daily_limit, max_concurrency, promotion_policy, active) VALUES ('realm-dou-zun-peak', 'doupo-default', 'dou-zun-peak', '斗尊巅峰', '#0369a1', 'Waves', 'minimal-line', 999, 200, 2, 'auto', 0)",
        )
        .run();
      store
        .raw!.query(
          "INSERT INTO realm_stages(id, realm_id, name, stage_order, required_xp, active) VALUES ('realm-dou-zun-peak-1', 'realm-dou-zun-peak', '一转', 999, 3250, 0)",
        )
        .run();

      expect(
        service
          .getConfiguration()
          .realms.some((realm) => realm.code === "dou-zun-peak"),
      ).toBe(false);
      expect(
        store
          .raw!.query("SELECT name FROM realms WHERE code = 'dou-zun-peak'")
          .get(),
      ).toEqual({ name: "斗尊巅峰" });
    } finally {
      store.close();
    }
  });

  test("reserves quota and settles only successful images", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-settlement", "测试结算");
      const before = service.getProfile("user");
      expect(before.dailyLimit).toBe(0);
      expect(before.remainingToday).toBe(0);

      service.reserveGeneration({
        jobId: "job-1",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count: 2,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      expect(service.getProfile("user")).toMatchObject({ remainingToday: 0, paidImages: 38, proxyQuota: { remainingToday: 10 } });

      service.settleGeneration({
        jobId: "job-1",
        successCount: 1,
        failCount: 1,
        durationMs: 250,
      });
      const after = service.getProfile("user");
      expect(after.usedToday).toBe(0);
      expect(after.remainingToday).toBe(0);
      expect(after.paidImages).toBe(39);
      expect(after.todaySuccessfulImages).toBe(1);
      expect(after.totalXp).toBe(10);
      expect(after.totalImages).toBe(1);
      expect(after.activeDays).toBe(1);
      expect(after.modelUsage).toEqual([
        { model: "gpt-image-1", jobs: 1, images: 1 },
      ]);

      service.settleGeneration({
        jobId: "job-1",
        successCount: 1,
        failCount: 1,
        durationMs: 250,
      });
      expect(service.getProfile("user").totalXp).toBe(10);
    } finally {
      store.close();
    }
  });

  test("refunds a failed reservation and enforces concurrency and capabilities", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-refund", "测试退款");
      expect(() =>
        service.reserveGeneration({
          jobId: "job-high",
          userId: "user",
          channelId: "channel",
          model: "gpt-image-1",
          count: 1,
          quality: "high",
          referenceCount: 0,
          hasMask: false,
          activeJobs: 0,
        }),
      ).toThrow("当前境界尚未掌握");
      expect(() =>
        service.reserveGeneration({
          jobId: "job-busy",
          userId: "user",
          channelId: "channel",
          model: "gpt-image-1",
          count: 1,
          quality: "auto",
          referenceCount: 0,
          hasMask: false,
          activeJobs: 1,
        }),
      ).toThrow("同时生成");

      service.reserveGeneration({
        jobId: "job-fail",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count: 3,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      expect(service.getProfile("user").paidImages).toBe(37);
      service.refundGeneration("job-fail", "upstream failed");
      expect(service.getProfile("user").paidImages).toBe(40);
      expect(service.getProfile("user").totalXp).toBe(0);
    } finally {
      store.close();
    }
  });

  test("consumes accepted proxy work without awarding image XP or image totals", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.reserveGeneration({
        jobId: "proxy-work",
        kind: "proxy",
        userId: "user",
        channelId: "video-channel",
        model: "video-model",
        count: 1,
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });

      expect(service.getGenerationUsage("proxy-work")?.status).toBe("reserved");
      service.consumeGeneration("proxy-work", 350);
      service.consumeGeneration("proxy-work", 500);

      const profile = service.getProfile("user");
      expect(profile.usedToday).toBe(1);
      expect(profile.remainingToday).toBe(0);
      expect(profile.proxyQuota.remainingToday).toBe(9);
      expect(profile.todaySuccessfulImages).toBe(0);
      expect(profile.totalXp).toBe(0);
      expect(profile.totalImages).toBe(0);
      expect(service.getGenerationUsage("proxy-work")?.status).toBe("settled");
    } finally {
      store.close();
    }
  });

  test("does not allow cultivation administration to disable the administrator", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      expect(() =>
        service.updateUser("admin", "admin", { status: "DISABLED" }, ""),
      ).toThrow("不能停用管理员账号");
      expect(() =>
        service.updateUser("admin", "missing", { currentXp: 10 }, ""),
      ).toThrow("用户不存在");
      expect(service.getProfile("admin").userId).toBe("admin");
    } finally {
      store.close();
    }
  });

  test("records administrative changes with optional reasons and exposes paginated logs", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      const configuration = service.getConfiguration();
      const targetStage = configuration.realms[1].stages[1];
      const noReasonTarget = configuration.realms[2].stages[0];

      service.updateUser(
        "admin",
        "user",
        {
          stageId: targetStage.id,
          xpDelta: 50,
          dailyLimitOverride: 25,
          internalNote: "internal",
          publicMessage: "keep creating",
        },
        "manual adjustment",
      );
      const profile = service.getProfile("user");
      expect(profile.stageId).toBe(targetStage.id);
      expect(profile.totalXp).toBe(50);
      expect(profile.dailyLimit).toBe(0);
      expect(profile.proxyQuota.dailyLimit).toBe(25);
      expect(profile.publicMessage).toBe("keep creating");

      const ledger = service.listLedger("user", 1, 20).items[0];
      const auditLog = service.listAuditLogs(1, 20).items[0];
      expect(ledger.amount).toBe(50);
      expect(ledger.display_name).toBe("User");
      expect(auditLog.reason).toBe("manual adjustment");
      expect(auditLog.admin_name).toBe("Admin");
      expect(auditLog.target_name).toBe("User");

      service.recordLogin({
        userId: "user",
        displayName: "User",
        result: "success",
        ip: "203.0.113.10",
        userAgent: "test-agent",
        secret: "test-secret",
      });
      const loginLogs = service.listLoginLogs(1, 20);
      expect(loginLogs.total).toBe(1);
      expect(
        (loginLogs.items[0] as { display_name: string }).display_name,
      ).toBe("User");

      expect(() =>
        service.updateUser(
          "admin",
          "user",
          {
            stageId: noReasonTarget.id,
            xpDelta: 1,
            dailyLimitOverride: 30,
          },
          "",
        ),
      ).not.toThrow();
      expect(service.getProfile("user").stageId).toBe(noReasonTarget.id);
      expect(
        store
          .raw!.query(
            "SELECT reason FROM admin_audit_logs WHERE target_user_id = ? AND reason = ?",
          )
          .get("user", "管理员直接调整"),
      ).toEqual({ reason: "管理员直接调整" });
      expect(
        store
          .raw!.query(
            "SELECT reason FROM cultivation_ledger WHERE user_id = ? AND reason = ?",
          )
          .get("user", "管理员直接调整"),
      ).toEqual({ reason: "管理员直接调整" });
    } finally {
      store.close();
    }
  });

  test("keeps reservations idempotent and preserves cultivation data across state writes", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-idempotent", "测试重复请求");
      service.reserveGeneration({
        jobId: "same-job",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count: 1,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      expect(() =>
        service.reserveGeneration({
          jobId: "same-job",
          allowPaidImages: true,
          userId: "user",
          channelId: "channel",
          model: "gpt-image-1",
          count: 1,
          quality: "auto",
          referenceCount: 0,
          hasMask: false,
          activeJobs: 99,
        }),
      ).not.toThrow();
      service.settleGeneration({
        jobId: "same-job",
        successCount: 1,
        failCount: 0,
        durationMs: 100,
      });
      expect(service.getProfile("user").totalXp).toBe(10);

      const state = store.loadState();
      state.users.user.displayName = "Updated User";
      store.saveState(state);
      expect(service.getProfile("user").totalXp).toBe(10);
      expect(service.getProfile("user").displayName).toBe("Updated User");
    } finally {
      store.close();
    }
  });

  test("automatically advances across realm boundaries and preserves overflow", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      const configuration = service.getConfiguration();
      const source = configuration.realms[0].stages.at(-1)!;
      const target = configuration.realms[1].stages[0];
      const automaticTarget = configuration.realms[1].stages[1];
      service.updateUser(
        "admin",
        "user",
        {
          stageId: source.id,
          currentXp: source.requiredXp + target.requiredXp + 5,
        },
        "",
      );
      const profile = service.getProfile("user");
      expect(profile.stageId).toBe(automaticTarget.id);
      expect(profile.currentXp).toBe(5);
      expect(profile.pendingStageId).toBeNull();
      expect(profile).toMatchObject({ dailyLimit: 0, unlimited: false, remainingToday: 0, proxyQuota: { dailyLimit: 20 } });
    } finally {
      store.close();
    }
  });

  test("refunds a reserved job after reopening the SQLite database", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    service.grantWalletPackage("admin", "user", "qiling", "grant-restart", "测试重启退款");
    service.reserveGeneration({
      jobId: "restart-job",
      allowPaidImages: true,
      userId: "user",
      channelId: "channel",
      model: "gpt-image-1",
      count: 2,
      quality: "auto",
      referenceCount: 0,
      hasMask: false,
      activeJobs: 0,
    });
    expect(service.getProfile("user").paidImages).toBe(38);
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const reopenedService = createCultivationService(reopened.raw!, {
        now: () => new Date("2026-07-22T08:00:00+08:00"),
      });
      reopenedService.refundGeneration("restart-job", "server restarted");
      expect(reopenedService.getProfile("user")).toMatchObject({ dailyLimit: 0, remainingToday: 0, unlimited: false, paidImages: 40 });
    } finally {
      reopened.close();
    }
  });

  test("preserves finite proxy overrides at Dou Emperor and global capability switches", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      const configuration = service.getConfiguration();
      const topStage = configuration.realms.at(-1)!.stages.at(-1)!;
      service.updateUser(
        "admin",
        "user",
        { stageId: topStage.id, dailyLimitOverride: 5, unlimited: false },
        "set finite quota",
      );
      expect(service.getProfile("user").dailyLimit).toBeNull();
      expect(service.getProfile("user").dailyLimitOverride).toBeNull();
      expect(service.getProfile("user").proxyQuota).toMatchObject({ dailyLimit: 5, dailyLimitOverride: 5, unlimited: false });
      expect(service.getProfile("user").unlimited).toBe(true);

      service.updateCapability(
        "admin",
        "model.gpt-image",
        { active: false },
        "disable model",
      );
      expect(service.getProfile("user").capabilities).not.toContain(
        "model.gpt-image",
      );
      expect(() =>
        service.reserveGeneration({
          jobId: "disabled-capability",
          userId: "user",
          channelId: "channel",
          model: "gpt-image-1",
          count: 1,
          quality: "auto",
          referenceCount: 0,
          hasMask: false,
          activeJobs: 0,
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  test("does not restore a stage capability removed by an administrator after restart", () => {
    const { store, service, dataDir } = setup();
    const firstStage = service.getConfiguration().realms[0].stages[0];
    const removedCapability = firstStage.capabilities[0];
    service.updateStage(
      "admin",
      firstStage.id,
      {
        capabilities: firstStage.capabilities.filter(
          (capability) => capability !== removedCapability,
        ),
      },
      "remove default capability",
    );
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const reopenedService = createCultivationService(reopened.raw!, {
        now: () => new Date("2026-07-22T08:00:00+08:00"),
      });
      const reopenedStage = reopenedService
        .getConfiguration()
        .realms.flatMap((realm) => realm.stages)
        .find((stage) => stage.id === firstStage.id);
      expect(reopenedStage?.capabilities).not.toContain(removedCapability);
    } finally {
      reopened.close();
    }
  });

  test("allocates new users only to active stages in active realms", () => {
    const { store, service } = setup();
    try {
      const realms = service.getConfiguration().realms;
      service.updateRealm(
        "admin",
        realms[0].id,
        { active: false },
        "disable empty realm",
      );

      service.ensureUser("user", false);
      expect(service.getProfile("user").realmId).toBe(realms[1].id);
    } finally {
      store.close();
    }
  });

  test("rejects disabling stages and realms assigned to current users", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const profile = service.getProfile("user");

      expect(() =>
        service.updateStage(
          "admin",
          profile.stageId,
          { active: false },
          "disable assigned stage",
        ),
      ).toThrow("正在使用");
      expect(() =>
        service.updateRealm(
          "admin",
          profile.realmId,
          { active: false },
          "disable assigned realm",
        ),
      ).toThrow("正在使用");
    } finally {
      store.close();
    }
  });

  test("rejects assigning a user to an inactive stage or inactive realm", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const target = service.getConfiguration().realms[1].stages[0];
      service.updateStage(
        "admin",
        target.id,
        { active: false },
        "disable unused target",
      );

      expect(() =>
        service.updateUser(
          "admin",
          "user",
          { stageId: target.id },
          "assign inactive target",
        ),
      ).toThrow("未启用");
    } finally {
      store.close();
    }
  });

  test("direct current XP updates immediately apply automatic promotion", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      const configuration = service.getConfiguration();
      const source = configuration.realms[0].stages.at(-1)!;
      const target = configuration.realms[1].stages[0];
      service.updateUser(
        "admin",
        "user",
        {
          stageId: source.id,
          currentXp: source.requiredXp,
        },
        "",
      );
      const profile = service.getProfile("user");
      expect(profile.stageId).toBe(target.id);
      expect(profile.currentXp).toBe(0);
      expect(profile.pendingStageId).toBeNull();
    } finally {
      store.close();
    }
  });

  test("exposes the raw unlimited override separately from inherited proxy quotas", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      expect(service.getProfile("user").proxyQuota).toMatchObject({ unlimited: false, unlimitedOverride: false });
      const emperor = service.getConfiguration().realms.find((realm) => realm.code === "dou-emperor")!;
      service.updateUser("admin", "user", { stageId: emperor.stages[0].id }, "继承境界额度");
      expect(service.getProfile("user")).toMatchObject({ unlimited: true, proxyQuota: { dailyLimit: null, unlimited: true, unlimitedOverride: false } });
      service.updateUser("admin", "user", { dailyLimitOverride: 5 }, "设置有限额度");
      expect(service.getProfile("user").proxyQuota).toMatchObject({ dailyLimit: 5, unlimited: false, unlimitedOverride: false });
      service.updateUser("admin", "user", { unlimited: true }, "明确设为无限");
      expect(service.getProfile("user").proxyQuota).toMatchObject({ dailyLimit: 5, unlimited: true, unlimitedOverride: true });
      service.updateUser("admin", "user", { internalNote: "仅修改备注" }, "保留原始覆盖");
      expect(service.getProfile("user").proxyQuota.unlimitedOverride).toBe(true);
      service.updateUser("admin", "user", { unlimited: false }, "取消无限覆盖");
      expect(service.getProfile("user").proxyQuota).toMatchObject({ unlimited: false, unlimitedOverride: false });
      service.updateUser("admin", "user", { dailyLimitOverride: null }, "恢复境界额度");
      expect(service.getProfile("user").proxyQuota).toMatchObject({ unlimited: true, unlimitedOverride: false });
    } finally {
      store.close();
    }
  });

  test("uses actual current XP changes for absolute settings, signed adjustments and reward ledgers", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.updateUser("admin", "user", { currentXp: 40 }, "直接设置修为");
      expect(service.updateUser("admin", "user", { xpDelta: -10 }, "扣减当前修为")).toMatchObject({ currentXp: 30, totalXp: 30 });
      expect(service.updateUser("admin", "user", { currentXp: 20, xpDelta: -5 }, "设值后扣减")).toMatchObject({ currentXp: 15, totalXp: 15 });
      expect(service.updateUser("admin", "user", { xpDelta: -100 }, "扣到零为止")).toMatchObject({ currentXp: 0, totalXp: 0 });
      expect(service.updateUser("admin", "user", { xpDelta: 10 }, "增加当前修为")).toMatchObject({ currentXp: 10, totalXp: 10 });
      expect(store.raw!.query("SELECT amount, balance_after, event_type, operator_user_id FROM cultivation_ledger ORDER BY rowid").all()).toEqual([
        { amount: 40, balance_after: 40, event_type: "XP_ADJUST", operator_user_id: "admin" },
        { amount: -10, balance_after: 30, event_type: "XP_ADJUST", operator_user_id: "admin" },
        { amount: -10, balance_after: 20, event_type: "XP_ADJUST", operator_user_id: "admin" },
        { amount: -5, balance_after: 15, event_type: "XP_ADJUST", operator_user_id: "admin" },
        { amount: -15, balance_after: 0, event_type: "XP_ADJUST", operator_user_id: "admin" },
        { amount: 10, balance_after: 10, event_type: "XP_ADJUST", operator_user_id: "admin" },
      ]);
      const deductionAudit = store.raw!.query("SELECT before_json, after_json FROM admin_audit_logs WHERE reason = '扣减当前修为'").get() as { before_json: string; after_json: string };
      expect(JSON.parse(deductionAudit.before_json).profile).toMatchObject({ currentXp: 40, totalXp: 40 });
      expect(JSON.parse(deductionAudit.after_json).profile).toMatchObject({ currentXp: 30, totalXp: 30 });
      service.grantRegistrationImages("user");
      service.reserveGeneration({ jobId: "xp-adjust-reward", userId: "user", channelId: "channel", model: "gpt-image-1", count: 1, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      expect(service.settleGeneration({ jobId: "xp-adjust-reward", successCount: 1, failCount: 0, durationMs: 10 })).toMatchObject({ currentXp: 20, totalXp: 20 });
      expect(store.raw!.query("SELECT amount, balance_after, event_type, source_type FROM cultivation_ledger WHERE source_id = 'xp-adjust-reward'").get()).toEqual({ amount: 10, balance_after: 20, event_type: "XP_GAIN", source_type: "generation" });
    } finally {
      store.close();
    }
  });

  test("preserves spent cumulative XP and Dou Emperor rights when current XP is reduced", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const stages = service.getConfiguration().realms[0].stages;
      service.updateUser("admin", "user", { currentXp: stages[0].requiredXp + 7 }, "设置修为并升级");
      expect(service.getProfile("user")).toMatchObject({ stageId: stages[1].id, currentXp: 7, totalXp: stages[0].requiredXp + 7 });
      expect(service.updateUser("admin", "user", { xpDelta: -1000 }, "仅扣剩余修为")).toMatchObject({ stageId: stages[1].id, currentXp: 0, totalXp: stages[0].requiredXp });
      expect(service.updateUser("admin", "user", { currentXp: 20 }, "保留已消耗累计")).toMatchObject({ currentXp: 20, totalXp: stages[0].requiredXp + 20 });
      expect(service.updateUser("admin", "user", { currentXp: 5 }, "降低当前修为")).toMatchObject({ currentXp: 5, totalXp: stages[0].requiredXp + 5 });
      const emperor = service.getConfiguration().realms.find((realm) => realm.code === "dou-emperor")!;
      service.updateUser("admin", "user", { stageId: emperor.stages[0].id, currentXp: 3 }, "保留斗帝权益");
      expect(service.updateUser("admin", "user", { xpDelta: -10 }, "斗帝扣减修为")).toMatchObject({ stageId: emperor.stages[0].id, currentXp: 0, totalXp: stages[0].requiredXp, unlimited: true, dailyLimit: null, remainingToday: null });
      expect(store.raw!.query("SELECT amount FROM cultivation_ledger WHERE reason = '仅扣剩余修为'").get()).toEqual({ amount: -7 });
    } finally {
      store.close();
    }
  });

  test("repairs legacy uncounted current XP explicitly before applying an adjustment", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      store.raw!.query("UPDATE user_cultivation SET current_xp = 40, total_xp = 0 WHERE user_id = 'user'").run();
      expect(service.updateUser("admin", "user", { xpDelta: -10 }, "扣减历史设值")).toMatchObject({ currentXp: 30, totalXp: 30 });
      expect(store.raw!.query("SELECT amount, balance_after, operator_user_id, reason FROM cultivation_ledger ORDER BY rowid").all()).toEqual([
        { amount: 40, balance_after: 40, operator_user_id: "admin", reason: "补齐历史当前修为对应的累计修为" },
        { amount: -10, balance_after: 30, operator_user_id: "admin", reason: "扣减历史设值" },
      ]);
      const log = service.listAuditLogs().items[0] as { before_json: string; after_json: string };
      expect(JSON.parse(log.before_json).profile).toMatchObject({ currentXp: 40, totalXp: 0 });
      expect(JSON.parse(log.after_json).profile).toMatchObject({ currentXp: 30, totalXp: 30 });
    } finally {
      store.close();
    }
  });

  test("rolls XP repairs, signed ledgers and promotion back when user audit fails", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      store.raw!.query("UPDATE user_cultivation SET current_xp = 40, total_xp = 0 WHERE user_id = 'user'").run();
      const before = service.getProfile("user");
      store.raw!.exec("CREATE TRIGGER reject_xp_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action = 'cultivation.user.update' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      expect(() => service.updateUser("admin", "user", { currentXp: before.requiredXp + 5 }, "测试原子回滚")).toThrow("audit unavailable");
      expect(service.getProfile("user")).toEqual(before);
      expect(service.listLedger("user").total).toBe(0);
      expect(store.raw!.query("SELECT COUNT(*) AS count FROM breakthrough_history").get()).toEqual({ count: 0 });
      expect(service.listAuditLogs().total).toBe(0);
    } finally {
      store.close();
    }
  });

  test("audits persisted stage capabilities before replacement, removal and clearing", () => {
    const { store, service } = setup();
    try {
      const stage = service.getConfiguration().realms[0].stages[0];
      const replacement = ["model.gemini", "generation.hd"];
      service.updateStage("admin", stage.id, { name: "新阶段名称", capabilities: [...replacement, replacement[0], "unknown.capability"] }, "替换阶段能力");
      service.updateStage("admin", stage.id, { capabilities: [replacement[0]] }, "移除阶段能力");
      service.updateStage("admin", stage.id, { capabilities: [] }, "清空阶段能力");
      const logs = store.raw!.query("SELECT reason, before_json, after_json FROM admin_audit_logs WHERE action = 'cultivation.stage.update' ORDER BY rowid").all() as Array<{ reason: string; before_json: string; after_json: string }>;
      expect(logs.map((log) => ({ reason: log.reason, before: JSON.parse(log.before_json).capabilities, after: JSON.parse(log.after_json).capabilities }))).toEqual([
        { reason: "替换阶段能力", before: stage.capabilities, after: [...replacement].sort() },
        { reason: "移除阶段能力", before: [...replacement].sort(), after: [replacement[0]] },
        { reason: "清空阶段能力", before: [replacement[0]], after: [] },
      ]);
      expect(JSON.parse(logs[0].before_json).name).toBe(stage.name);
      expect(JSON.parse(logs[0].after_json).name).toBe("新阶段名称");
      expect(service.getConfiguration().realms[0].stages[0].capabilities).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("rolls stage changes and capability replacement back when stage audit fails", () => {
    const { store, service } = setup();
    try {
      const before = service.getConfiguration();
      const stage = before.realms[0].stages[0];
      store.raw!.exec("CREATE TRIGGER reject_stage_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action = 'cultivation.stage.update' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      expect(() => service.updateStage("admin", stage.id, { name: "应回滚名称", requiredXp: stage.requiredXp + 10, capabilities: [] }, "测试原子回滚")).toThrow("audit unavailable");
      expect(service.getConfiguration()).toEqual(before);
      expect(service.listAuditLogs().total).toBe(0);
    } finally {
      store.close();
    }
  });

  test("reconciles orphaned reservations after restart and preserves resumable jobs", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    service.grantWalletPackage("admin", "user", "qiling", "grant-reconcile", "测试恢复任务");
    for (const [jobId, count] of [
      ["orphan-job", 2],
      ["active-job", 1],
    ] as const)
      service.reserveGeneration({
        jobId,
        allowPaidImages: true,
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
    expect(service.getProfile("user").paidImages).toBe(37);
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const reopenedService = createCultivationService(reopened.raw!, {
        now: () => new Date("2026-07-22T08:00:00+08:00"),
      });
      expect(
        reopenedService.reconcileReservations(new Set(["active-job"])),
      ).toEqual(["orphan-job"]);
      expect(reopenedService.getProfile("user").paidImages).toBe(39);
      expect(
        reopened
          .raw!.query("SELECT status FROM generation_usage WHERE job_id = ?")
          .get("orphan-job"),
      ).toEqual({ status: "refunded" });
      expect(
        reopened
          .raw!.query("SELECT status FROM generation_usage WHERE job_id = ?")
          .get("active-job"),
      ).toEqual({ status: "reserved" });
      expect(
        reopenedService.reconcileReservations(new Set(["active-job"])),
      ).toEqual([]);
      expect(reopenedService.getProfile("user").paidImages).toBe(39);
    } finally {
      reopened.close();
    }
  });

  test("aggregates recent channel health without adding another metrics table", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantWalletPackage("admin", "user", "qiling", "grant-metrics", "测试渠道统计");
      service.reserveGeneration({
        jobId: "channel-a-settled",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel-a",
        model: "gpt-image-1",
        count: 2,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      service.settleGeneration({
        jobId: "channel-a-settled",
        successCount: 1,
        failCount: 1,
        durationMs: 2_000,
      });
      service.reserveGeneration({
        jobId: "channel-a-refunded",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel-a",
        model: "gpt-image-1",
        count: 1,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      service.refundGeneration("channel-a-refunded", "upstream failed");
      service.reserveGeneration({
        jobId: "channel-b-active",
        allowPaidImages: true,
        userId: "user",
        channelId: "channel-b",
        model: "gpt-image-1",
        count: 1,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });

      const metrics = service.listChannelMetrics(7);
      expect(metrics).toHaveLength(2);
      expect(metrics.find((item) => item.channelId === "channel-a")).toEqual({
        userId: "user",
        channelId: "channel-a",
        totalJobs: 2,
        settledJobs: 1,
        refundedJobs: 1,
        activeJobs: 0,
        requestedImages: 3,
        successImages: 1,
        failedImages: 2,
        avgDurationMs: 2_000,
        p95DurationMs: 2_000,
        lastUsedAt: new Date("2026-07-22T08:00:00+08:00").getTime(),
      });
      expect(metrics.find((item) => item.channelId === "channel-b")).toEqual({
        userId: "user",
        channelId: "channel-b",
        totalJobs: 1,
        settledJobs: 0,
        refundedJobs: 0,
        activeJobs: 1,
        requestedImages: 1,
        successImages: 0,
        failedImages: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        lastUsedAt: new Date("2026-07-22T08:00:00+08:00").getTime(),
      });
    } finally {
      store.close();
    }
  });
});

describe("admin image balance adjustments and user filters", () => {
  test("rejects invalid balances, adjustment IDs, reasons and unrelated user fields without writes", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const valid = { imageBalance: 5, expectedImageBalance: 0, adjustmentId: randomUUID() };
      const invalid = [
        null, [], {},
        ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "5", null, undefined].flatMap((value) => [
          { ...valid, imageBalance: value }, { ...valid, expectedImageBalance: value },
        ]),
        { ...valid, adjustmentId: "not-a-uuid" }, { ...valid, adjustmentId: 123 },
        { ...valid, reason: "x".repeat(301) }, { ...valid, reason: null },
        { ...valid, stageId: "realm-dou-emperor" }, { ...valid, xpDelta: 10 },
      ];
      for (const input of invalid) expect(() => service.setImageBalance("admin", "user", input as any)).toThrow(CultivationError);
      expect(service.getWallet("user")).toMatchObject({ balance: 0, total: 0 });
      expect(service.listAuditLogs().total).toBe(0);
    } finally {
      store.close();
    }
  });

  test("sets absolute balances up, down and to zero with signed ledger entries and before/after audit", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const before = service.getProfile("user");
      expect(service.setImageBalance("admin", "user", { imageBalance: 17, expectedImageBalance: 0, adjustmentId: randomUUID() })).toEqual({ ...before, paidImages: 17 });
      service.setImageBalance("admin", "user", { imageBalance: 2, expectedImageBalance: 17, adjustmentId: randomUUID(), reason: "  更正次数  " });
      service.setImageBalance("admin", "user", { imageBalance: 0, expectedImageBalance: 2, adjustmentId: randomUUID() });
      expect(service.getWallet("user").items.map((item: any) => [item.kind, item.delta, item.balanceAfter, item.packageId])).toEqual([
        ["admin_grant", -2, 0, null], ["admin_grant", -15, 2, null], ["admin_grant", 17, 17, null],
      ]);
      expect(store.raw!.query("SELECT operator_user_id, reason FROM wallet_ledger WHERE delta = -15").get()).toEqual({ operator_user_id: "admin", reason: "更正次数" });
      const audit = store.raw!.query("SELECT action, before_json, after_json FROM admin_audit_logs WHERE reason = '更正次数'").get() as { action: string; before_json: string; after_json: string };
      expect(audit.action).toBe("cultivation.user.image_balance");
      expect(JSON.parse(audit.before_json)).toEqual({ imageBalance: 17 });
      expect(JSON.parse(audit.after_json)).toEqual({ imageBalance: 2 });
      service.setImageBalance("admin", "user", { imageBalance: Number.MAX_SAFE_INTEGER, expectedImageBalance: 0, adjustmentId: randomUUID() });
      expect(service.getWallet("user").balance).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      store.close();
    }
  });

  test("replays a durable adjustment before CAS without resetting later generation usage and rejects key reuse", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const input = { imageBalance: 9, expectedImageBalance: 0, adjustmentId: randomUUID(), reason: "测试调整" };
      service.setImageBalance("admin", "user", input);
      service.reserveGeneration({ jobId: "after-adjustment", userId: "user", channelId: "channel", model: "gpt-image-1", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      const restored = createCultivationService(store.raw!);
      expect(restored.setImageBalance("admin", "user", input).paidImages).toBe(7);
      expect(service.getWallet("user").total).toBe(2);
      expect(service.listAuditLogs().total).toBe(1);
      for (const retry of [
        { admin: "other-admin", user: "user", input },
        { admin: "admin", user: "admin", input },
        { admin: "admin", user: "user", input: { ...input, imageBalance: 10 } },
        { admin: "admin", user: "user", input: { ...input, expectedImageBalance: 1 } },
        { admin: "admin", user: "user", input: { ...input, reason: "另一用途" } },
      ]) {
        try {
          service.setImageBalance(retry.admin, retry.user, retry.input);
          throw new Error("expected source conflict");
        } catch (error) {
          expect(error).toMatchObject({ status: 409, code: "WALLET_SOURCE_CONFLICT" });
        }
      }
      const packageId = randomUUID();
      service.grantWalletPackage("admin", "user", "qiling", packageId, "预设套餐");
      expect(() => service.setImageBalance("admin", "user", { ...input, adjustmentId: packageId })).toThrow("调整请求编号已用于其他操作");
      expect(service.getWallet("user").balance).toBe(47);
    } finally {
      store.close();
    }
  });

  test("rejects stale balances atomically and records no-op intents so replay preserves later credits", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const input = { imageBalance: 0, expectedImageBalance: 0, adjustmentId: randomUUID() };
      service.setImageBalance("admin", "user", input);
      service.grantRegistrationImages("user");
      expect(service.setImageBalance("admin", "user", input).paidImages).toBe(6);
      const wallet = service.getWallet("user");
      const auditCount = service.listAuditLogs().total;
      try {
        service.setImageBalance("admin", "user", { imageBalance: 10, expectedImageBalance: 0, adjustmentId: randomUUID() });
        throw new Error("expected stale balance conflict");
      } catch (error) {
        expect(error).toMatchObject({ status: 409, code: "WALLET_BALANCE_CONFLICT" });
      }
      expect(service.getWallet("user")).toEqual(wallet);
      expect(service.listAuditLogs().total).toBe(auditCount);
      expect(() => service.setImageBalance("admin", "missing-user", { ...input, adjustmentId: randomUUID() })).toThrow("用户不存在");
      expect(store.raw!.query("SELECT 1 FROM wallet_balances WHERE user_id = 'missing-user'").get()).toBeNull();
    } finally {
      store.close();
    }
  });

  test("keeps pending paid reservations, refunds, onboarding, proxy quotas and Dou Emperor entitlements", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.grantRegistrationImages("user");
      service.updateUser("admin", "user", { dailyLimitOverride: 17, unlimited: false }, "其他服务额度");
      service.reserveGeneration({ jobId: "adjust-reserved", userId: "user", channelId: "channel", model: "gpt-image-1", count: 2, referenceCount: 0, hasMask: false, activeJobs: 0, allowPaidImages: true });
      const usage = store.raw!.query("SELECT * FROM generation_usage WHERE job_id = 'adjust-reserved'").get();
      const before = service.getProfile("user");
      expect(service.setImageBalance("admin", "user", { imageBalance: 10, expectedImageBalance: 4, adjustmentId: randomUUID() })).toEqual({ ...before, paidImages: 10 });
      expect(store.raw!.query("SELECT * FROM generation_usage WHERE job_id = 'adjust-reserved'").get()).toEqual(usage);
      service.settleGeneration({ jobId: "adjust-reserved", successCount: 1, failCount: 1, durationMs: 10 });
      expect(service.grantRegistrationImages("user")).toBe(11);
      expect(service.getProfile("user")).toMatchObject({ remainingToday: 0, dailyLimit: 0, paidImages: 11, proxyQuota: { dailyLimit: 17, unlimited: false } });
      const emperor = service.getConfiguration().realms.find((realm) => realm.code === "dou-emperor")!;
      service.updateUser("admin", "user", { stageId: emperor.stages[0].id }, "斗帝资格");
      const emperorBefore = service.getProfile("user");
      expect(service.setImageBalance("admin", "user", { imageBalance: 3, expectedImageBalance: 11, adjustmentId: randomUUID() })).toEqual({ ...emperorBefore, paidImages: 3 });
      expect(service.getProfile("user")).toMatchObject({ unlimited: true, dailyLimit: null, remainingToday: null });
      expect(service.getWallet("admin").balance).toBe(0);
    } finally {
      store.close();
    }
  });

  test("rolls the balance and ledger back if its audit cannot be persisted", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      store.raw!.exec("CREATE TRIGGER reject_balance_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action = 'cultivation.user.image_balance' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      expect(() => service.setImageBalance("admin", "user", { imageBalance: 8, expectedImageBalance: 0, adjustmentId: randomUUID() })).toThrow("audit unavailable");
      expect(service.getWallet("user")).toMatchObject({ balance: 0, total: 0 });
      expect(service.listAuditLogs().total).toBe(0);
    } finally {
      store.close();
    }
  });

  test("searches literal nickname or UID substrings with matching pagination totals", () => {
    const { store, service } = setup();
    try {
      for (const [id, name, createdAt] of [["uid_%\\literal", "Under_score%\\literal", 2], ["id-search-1", "Artist", 3], ["id-search-2", "Artist", 4]] as const) {
        store.raw!.query("INSERT INTO users(user_id, display_name, created_at) VALUES (?, ?, ?)").run(id, name, createdAt);
        service.ensureUser(id, false);
      }
      service.ensureUser("user", false);
      service.ensureUser("admin", true);
      for (const search of ["%", "_", "\\", "uid_", "score%\\", "  uid_%\\literal  "])
        expect(service.listUsers(1, 20, search).items.map((item) => item.userId)).toEqual(["uid_%\\literal"]);
      expect(service.listUsers(1, 1, "Artist")).toMatchObject({ page: 1, pageSize: 1, total: 2, items: [{ userId: "id-search-2" }] });
      expect(service.listUsers(2, 1, "id-search-")).toMatchObject({ page: 2, pageSize: 1, total: 2, items: [{ userId: "id-search-1" }] });
      expect(service.listUsers(3, 1, "Artist")).toMatchObject({ total: 2, items: [] });
      expect(service.listUsers(1, 20, "admin").items.map((item) => item.userId)).toEqual(["admin"]);
      expect(service.listUsers(1, 20).total).toBe(5);
    } finally {
      store.close();
    }
  });

  test("filters audit targets and login users before pagination while keeping unfiltered logs", () => {
    const { store, service } = setup();
    try {
      const insertAudit = store.raw!.query("INSERT INTO admin_audit_logs(id, admin_user_id, target_user_id, action, reason, created_at) VALUES (?, ?, ?, 'test', '测试', ?)");
      insertAudit.run("a1", "admin", "user", 1);
      insertAudit.run("a2", "user", "admin", 2);
      insertAudit.run("a3", "admin", "user", 3);
      insertAudit.run("a4", "admin", "user", 4);
      expect(service.listAuditLogs(1, 2, "user")).toMatchObject({ total: 3, page: 1, pageSize: 2, items: [{ id: "a4" }, { id: "a3" }] });
      expect(service.listAuditLogs(2, 2, "user")).toMatchObject({ total: 3, items: [{ id: "a1" }] });
      expect(service.listAuditLogs(1, 20, "admin")).toMatchObject({ total: 1, items: [{ id: "a2" }] });
      expect(service.listAuditLogs().total).toBe(4);
      expect(service.listAuditLogs(1, 20, "missing").total).toBe(0);
      const insertLogin = store.raw!.query("INSERT INTO login_logs(id, user_id, display_name, result, ip_hash, ip_display, user_agent, created_at) VALUES (?, ?, '用户', 'success', '', '', '', ?)");
      insertLogin.run("l1", "user", 1);
      insertLogin.run("l2", "admin", 2);
      insertLogin.run("l3", "user", 3);
      insertLogin.run("l4", null, 4);
      expect(service.listLoginLogs(1, 1, "user")).toMatchObject({ total: 2, items: [{ id: "l3" }] });
      expect(service.listLoginLogs(2, 1, "user")).toMatchObject({ total: 2, items: [{ id: "l1" }] });
      expect(service.listLoginLogs().total).toBe(4);
      expect(service.listLoginLogs(1, 20, "missing").total).toBe(0);
    } finally {
      store.close();
    }
  });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "cultivation-"));
  directories.push(dataDir);
  const store = openAppDatabase({ dataDir });
  const state: ServerState = {
    version: 1,
    auth: { accessCodeHash: "", sessionSecret: "secret", adminUserId: "admin" },
    users: {
      admin: {
        userId: "admin",
        displayName: "Admin",
        admin: true,
        createdAt: 1,
      },
      user: { userId: "user", displayName: "User", createdAt: 1 },
    },
    channels: {},
    assets: {},
    jobs: {},
    projects: {},
    projectTombstones: {},
  };
  store.saveState(state);
  const now = new Date("2026-07-22T08:00:00+08:00");
  const service = createCultivationService(store.raw!, { now: () => now });
  return { store, service, dataDir };
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import type { ServerState } from "../../types";
import { createCultivationService } from "./service";

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

  test("reserves quota and settles only successful images", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      const before = service.getProfile("user");
      expect(before.dailyLimit).toBe(10);
      expect(before.remainingToday).toBe(10);

      service.reserveGeneration({
        jobId: "job-1",
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count: 2,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      expect(service.getProfile("user").remainingToday).toBe(8);

      service.settleGeneration({
        jobId: "job-1",
        successCount: 1,
        failCount: 1,
        durationMs: 250,
      });
      const after = service.getProfile("user");
      expect(after.usedToday).toBe(1);
      expect(after.remainingToday).toBe(9);
      expect(after.totalXp).toBe(10);
      expect(after.totalImages).toBe(1);
      expect(after.activeDays).toBe(1);

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
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count: 3,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
      expect(service.getProfile("user").remainingToday).toBe(7);
      service.refundGeneration("job-fail", "upstream failed");
      expect(service.getProfile("user").remainingToday).toBe(10);
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
        userId: "user",
        channelId: "video-channel",
        model: "video-model",
        count: 1,
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });

      expect(service.getGenerationUsage("proxy-work")?.status).toBe(
        "reserved",
      );
      service.consumeGeneration("proxy-work", 350);
      service.consumeGeneration("proxy-work", 500);

      const profile = service.getProfile("user");
      expect(profile.usedToday).toBe(1);
      expect(profile.remainingToday).toBe(9);
      expect(profile.totalXp).toBe(0);
      expect(profile.totalImages).toBe(0);
      expect(service.getGenerationUsage("proxy-work")?.status).toBe(
        "settled",
      );
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
      expect(profile.dailyLimit).toBe(25);
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
      expect((loginLogs.items[0] as { display_name: string }).display_name).toBe(
        "User",
      );

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
        store.raw!
          .query(
            "SELECT reason FROM admin_audit_logs WHERE target_user_id = ? AND reason = ?",
          )
          .get("user", "管理员直接调整"),
      ).toEqual({ reason: "管理员直接调整" });
      expect(
        store.raw!
          .query(
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
      service.reserveGeneration({
        jobId: "same-job",
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
    } finally {
      store.close();
    }
  });

  test("refunds a reserved job after reopening the SQLite database", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    service.reserveGeneration({
      jobId: "restart-job",
      userId: "user",
      channelId: "channel",
      model: "gpt-image-1",
      count: 2,
      quality: "auto",
      referenceCount: 0,
      hasMask: false,
      activeJobs: 0,
    });
    expect(service.getProfile("user").remainingToday).toBe(8);
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const reopenedService = createCultivationService(reopened.raw!, {
        now: () => new Date("2026-07-22T08:00:00+08:00"),
      });
      reopenedService.refundGeneration("restart-job", "server restarted");
      expect(reopenedService.getProfile("user").remainingToday).toBe(10);
    } finally {
      reopened.close();
    }
  });

  test("applies finite user quota overrides and global capability switches", () => {
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
      expect(service.getProfile("user").dailyLimit).toBe(5);
      expect(service.getProfile("user").dailyLimitOverride).toBe(5);
      expect(service.getProfile("user").unlimited).toBe(false);

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

  test("reconciles orphaned reservations after restart and preserves resumable jobs", () => {
    const { store, service, dataDir } = setup();
    service.ensureUser("user", false);
    for (const [jobId, count] of [
      ["orphan-job", 2],
      ["active-job", 1],
    ] as const)
      service.reserveGeneration({
        jobId,
        userId: "user",
        channelId: "channel",
        model: "gpt-image-1",
        count,
        quality: "auto",
        referenceCount: 0,
        hasMask: false,
        activeJobs: 0,
      });
    expect(service.getProfile("user").remainingToday).toBe(7);
    store.close();

    const reopened = openAppDatabase({ dataDir });
    try {
      const reopenedService = createCultivationService(reopened.raw!, {
        now: () => new Date("2026-07-22T08:00:00+08:00"),
      });
      expect(
        reopenedService.reconcileReservations(new Set(["active-job"])),
      ).toEqual(["orphan-job"]);
      expect(reopenedService.getProfile("user").remainingToday).toBe(9);
      expect(
        reopened.raw!
          .query("SELECT status FROM generation_usage WHERE job_id = ?")
          .get("orphan-job"),
      ).toEqual({ status: "refunded" });
      expect(
        reopened.raw!
          .query("SELECT status FROM generation_usage WHERE job_id = ?")
          .get("active-job"),
      ).toEqual({ status: "reserved" });
      expect(
        reopenedService.reconcileReservations(new Set(["active-job"])),
      ).toEqual([]);
      expect(reopenedService.getProfile("user").remainingToday).toBe(9);
    } finally {
      reopened.close();
    }
  });

  test("aggregates recent channel health without adding another metrics table", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("user", false);
      service.reserveGeneration({
        jobId: "channel-a-settled",
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

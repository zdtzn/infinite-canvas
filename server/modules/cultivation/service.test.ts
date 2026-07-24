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

  test("records administrative changes with reasons and exposes paginated logs", () => {
    const { store, service } = setup();
    try {
      service.ensureUser("admin", true);
      service.ensureUser("user", false);
      const configuration = service.getConfiguration();
      const targetStage = configuration.realms[1].stages[1];

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
      expect(() =>
        service.updateUser("admin", "user", { xpDelta: 1 }, ""),
      ).toThrow("原因");
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

  test("continues automatic star advancement after an approved realm boundary", () => {
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
          xpDelta: 1,
        },
        "prepare overflow",
      );
      expect(service.getProfile("user").pendingStageId).toBe(target.id);

      const profile = service.approveBreakthrough(
        "admin",
        "user",
        "approve boundary",
      );
      expect(profile.stageId).toBe(automaticTarget.id);
      expect(profile.currentXp).toBe(6);
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

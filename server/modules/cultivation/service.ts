import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";

import {
  DEFAULT_CAPABILITIES,
  DEFAULT_REALMS,
  requiredXp,
  stageLabel,
} from "./defaults";
import {
  advanceProgress,
  requiredCapabilityKeys,
  type ProgressStage,
} from "./policy";

export class CultivationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "CULTIVATION_ERROR",
  ) {
    super(message);
  }
}

type ServiceOptions = { now?: () => Date; timeZone?: string };
type ReservationInput = {
  jobId: string;
  userId: string;
  channelId: string;
  model: string;
  count: number;
  quality?: string;
  referenceCount: number;
  hasMask: boolean;
  operation?: "standard" | "inpaint" | "outpaint";
  activeJobs: number;
};
export type CultivationUserUpdate = {
  stageId?: string;
  currentXp?: number;
  xpDelta?: number;
  dailyLimitOverride?: number | null;
  unlimited?: boolean;
  status?: "NORMAL" | "DISABLED" | "BANNED";
  internalNote?: string;
  publicMessage?: string;
};
export type CultivationRealmUpdate = {
  name?: string;
  color?: string;
  iconKey?: string;
  animationPreset?: string;
  dailyLimit?: number | null;
  maxConcurrency?: number;
  promotionPolicy?: "auto" | "manual" | "boundary_manual";
  active?: boolean;
};
export type CultivationStageUpdate = {
  name?: string;
  requiredXp?: number;
  active?: boolean;
  capabilities?: string[];
};
export type CultivationCapabilityUpdate = { active?: boolean; label?: string };

export function createCultivationService(
  database: Database,
  options: ServiceOptions = {},
) {
  const now = options.now || (() => new Date());
  const timeZone = options.timeZone || "Asia/Shanghai";
  seedDefaults(database);

  function ensureUser(userId: string, isAdmin: boolean) {
    const existing = database
      .query("SELECT user_id FROM user_cultivation WHERE user_id = ?")
      .get(userId);
    if (existing) return;
    const stage = database
      .query(
        `SELECT id FROM realm_stages WHERE active = 1 ORDER BY stage_order ${isAdmin ? "DESC" : "ASC"} LIMIT 1`,
      )
      .get() as { id: string };
    const timestamp = now().getTime();
    database
      .query(
        "INSERT INTO user_cultivation(user_id, stage_id, current_xp, total_xp, unlimited_quota, started_at, updated_at) VALUES (?, ?, 0, 0, ?, ?, ?)",
      )
      .run(userId, stage.id, isAdmin ? 1 : 0, timestamp, timestamp);
  }

  function getProfile(userId: string) {
    const row = profileRow(database, userId);
    if (!row)
      throw new CultivationError("修炼信息不存在", 404, "PROFILE_NOT_FOUND");
    const date = dateKey(now(), timeZone);
    const usage = (database
      .query(
        "SELECT reserved_count, used_count, successful_images FROM daily_usage WHERE user_id = ? AND usage_date = ?",
      )
      .get(userId, date) as {
      reserved_count: number;
      used_count: number;
      successful_images: number;
    } | null) || { reserved_count: 0, used_count: 0, successful_images: 0 };
    const dailyLimit =
      row.daily_limit_override == null
        ? row.daily_limit == null
          ? null
          : Number(row.daily_limit)
        : Number(row.daily_limit_override);
    const unlimited = Boolean(row.unlimited_quota) || dailyLimit == null;
    const nextStage = database
      .query(
        "SELECT id, name FROM realm_stages WHERE active = 1 AND stage_order > ? ORDER BY stage_order LIMIT 1",
      )
      .get(row.stage_order) as { id: string; name: string } | null;
    const totalImages = Number(
      (
        database
          .query(
            "SELECT COALESCE(SUM(success_count), 0) AS value FROM generation_usage WHERE user_id = ? AND status = 'settled'",
          )
          .get(userId) as { value: number }
      ).value,
    );
    const activeDays = Number(
      (
        database
          .query(
            "SELECT COUNT(*) AS value FROM daily_usage WHERE user_id = ? AND successful_images > 0",
          )
          .get(userId) as { value: number }
      ).value,
    );
    const capabilities = (
      database
        .query(
          "SELECT sc.capability_key FROM stage_capabilities sc JOIN capability_definitions cd ON cd.capability_key = sc.capability_key WHERE sc.stage_id = ? AND sc.enabled = 1 AND cd.active = 1 ORDER BY sc.capability_key",
        )
        .all(row.stage_id) as Array<{ capability_key: string }>
    ).map((item) => item.capability_key);
    const remaining = unlimited
      ? null
      : Math.max(
          0,
          Number(dailyLimit) -
            Number(usage.used_count) -
            Number(usage.reserved_count),
        );
    const breakthrough = database
      .query(
        `SELECT h.id, h.from_stage_id, h.to_stage_id, h.status, f.name AS from_stage_name, t.name AS to_stage_name FROM breakthrough_history h JOIN realm_stages f ON f.id = h.from_stage_id JOIN realm_stages t ON t.id = h.to_stage_id WHERE h.user_id = ? AND h.seen_at IS NULL AND h.status IN ('automatic', 'approved') ORDER BY h.created_at DESC LIMIT 1`,
      )
      .get(userId) as Record<string, unknown> | null;
    return {
      userId,
      displayName: String(row.display_name),
      realmId: String(row.realm_id),
      realmName: String(row.realm_name),
      stageId: String(row.stage_id),
      stageName: String(row.stage_name),
      stageOrder: Number(row.stage_order),
      color: String(row.color),
      iconKey: String(row.icon_key),
      animationPreset: String(row.animation_preset),
      currentXp: Number(row.current_xp),
      totalXp: Number(row.total_xp),
      requiredXp: Number(row.required_xp),
      xpToNext: nextStage
        ? Math.max(0, Number(row.required_xp) - Number(row.current_xp))
        : 0,
      nextStageName: nextStage?.name || null,
      pendingStageId: row.pending_stage_id
        ? String(row.pending_stage_id)
        : null,
      dailyLimit,
      dailyLimitOverride:
        row.daily_limit_override == null
          ? null
          : Number(row.daily_limit_override),
      unlimited,
      usedToday: Number(usage.used_count),
      reservedToday: Number(usage.reserved_count),
      remainingToday: remaining,
      maxConcurrency: Number(row.max_concurrency),
      capabilities,
      totalImages,
      activeDays,
      publicMessage: String(row.public_message || ""),
      internalNote: String(row.internal_note || ""),
      breakthrough: breakthrough
        ? {
            id: String(breakthrough.id),
            fromStageName: String(breakthrough.from_stage_name),
            toStageName: String(breakthrough.to_stage_name),
            status: String(breakthrough.status),
          }
        : null,
    };
  }

  function reserveGeneration(input: ReservationInput) {
    const operation = database.transaction(() => {
      ensureUser(input.userId, false);
      const existing = database
        .query("SELECT status FROM generation_usage WHERE job_id = ?")
        .get(input.jobId) as { status: string } | null;
      if (existing) return getProfile(input.userId);
      const profile = getProfile(input.userId);
      if (input.activeJobs >= profile.maxConcurrency)
        throw new CultivationError(
          `当前境界最多同时生成 ${profile.maxConcurrency} 个任务`,
          429,
          "CONCURRENCY_LIMIT",
        );
      const required = requiredCapabilityKeys({
        model: input.model,
        quality: input.quality,
        references: input.referenceCount,
        hasMask: input.hasMask,
        operation: input.operation,
      });
      const granted = new Set(
        (
          database
            .query(
              "SELECT sc.capability_key FROM stage_capabilities sc JOIN capability_definitions cd ON cd.capability_key = sc.capability_key WHERE sc.stage_id = ? AND sc.enabled = 1 AND cd.active = 1",
            )
            .all(profile.stageId) as Array<{ capability_key: string }>
        ).map((item) => item.capability_key),
      );
      const missing = required.filter((key) => !granted.has(key));
      if (missing.length)
        throw new CultivationError(
          `当前境界尚未掌握此能力：${missing.join(", ")}`,
          403,
          "CAPABILITY_REQUIRED",
        );
      if (
        profile.remainingToday !== null &&
        profile.remainingToday < input.count
      )
        throw new CultivationError(
          "今日斗气已经耗尽",
          429,
          "DAILY_QUOTA_EXHAUSTED",
        );
      const date = dateKey(now(), timeZone);
      database
        .query(
          "INSERT INTO daily_usage(user_id, usage_date, reserved_count) VALUES (?, ?, ?) ON CONFLICT(user_id, usage_date) DO UPDATE SET reserved_count = reserved_count + excluded.reserved_count",
        )
        .run(input.userId, date, input.count);
      const rewardType =
        input.operation === "inpaint" || input.hasMask
          ? "inpaint"
          : input.operation === "outpaint"
            ? "outpaint"
            : input.quality === "high"
              ? "hd"
              : "standard";
      database
        .query(
          "INSERT INTO generation_usage(job_id, user_id, usage_date, model, channel_id, reward_type, requested_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)",
        )
        .run(
          input.jobId,
          input.userId,
          date,
          input.model,
          input.channelId,
          rewardType,
          input.count,
          now().getTime(),
        );
      return getProfile(input.userId);
    });
    return operation();
  }

  function settleGeneration(input: {
    jobId: string;
    successCount: number;
    failCount: number;
    durationMs: number;
  }) {
    return database.transaction(() => {
      const usage = database
        .query("SELECT * FROM generation_usage WHERE job_id = ?")
        .get(input.jobId) as Record<string, unknown> | null;
      if (!usage || usage.status !== "reserved")
        return usage ? getProfile(String(usage.user_id)) : null;
      const requested = Number(usage.requested_count);
      const success = Math.max(
        0,
        Math.min(requested, Math.floor(input.successCount)),
      );
      const failed = requested - success;
      database
        .query(
          "UPDATE daily_usage SET reserved_count = MAX(0, reserved_count - ?), used_count = used_count + ?, refunded_count = refunded_count + ?, successful_images = successful_images + ? WHERE user_id = ? AND usage_date = ?",
        )
        .run(
          requested,
          success,
          failed,
          success,
          usage.user_id,
          usage.usage_date,
        );
      database
        .query(
          "UPDATE generation_usage SET success_count = ?, fail_count = ?, duration_ms = ?, status = 'settled', settled_at = ? WHERE job_id = ?",
        )
        .run(
          success,
          failed,
          Math.max(0, input.durationMs),
          now().getTime(),
          input.jobId,
        );
      if (success > 0) {
        const reward =
          settingNumber(database, `xp.${String(usage.reward_type)}`, 0) *
          success;
        if (reward > 0)
          awardXp(
            database,
            String(usage.user_id),
            reward,
            "generation",
            input.jobId,
            "生成图片成功",
            now().getTime(),
          );
      }
      return getProfile(String(usage.user_id));
    })();
  }

  function refundGeneration(jobId: string, reason: string) {
    return database.transaction(() => {
      const usage = database
        .query("SELECT * FROM generation_usage WHERE job_id = ?")
        .get(jobId) as Record<string, unknown> | null;
      if (!usage || usage.status !== "reserved")
        return usage ? getProfile(String(usage.user_id)) : null;
      const requested = Number(usage.requested_count);
      database
        .query(
          "UPDATE daily_usage SET reserved_count = MAX(0, reserved_count - ?), refunded_count = refunded_count + ? WHERE user_id = ? AND usage_date = ?",
        )
        .run(requested, requested, usage.user_id, usage.usage_date);
      database
        .query(
          "UPDATE generation_usage SET fail_count = requested_count, status = 'refunded', settled_at = ? WHERE job_id = ?",
        )
        .run(now().getTime(), jobId);
      database
        .query(
          "UPDATE generation_usage SET estimated_cost_micros = estimated_cost_micros WHERE job_id = ?",
        )
        .run(jobId);
      return getProfile(String(usage.user_id));
    })();
  }

  function getConfiguration() {
    const realms = (
      database.query("SELECT * FROM realms ORDER BY sort_order").all() as Array<
        Record<string, unknown>
      >
    ).map((realm) => ({
      id: String(realm.id),
      code: String(realm.code),
      name: String(realm.name),
      color: String(realm.color),
      iconKey: String(realm.icon_key),
      animationPreset: String(realm.animation_preset),
      sortOrder: Number(realm.sort_order),
      dailyLimit: realm.daily_limit == null ? null : Number(realm.daily_limit),
      maxConcurrency: Number(realm.max_concurrency),
      promotionPolicy: String(realm.promotion_policy),
      active: Boolean(realm.active),
      stages: (
        database
          .query(
            "SELECT * FROM realm_stages WHERE realm_id = ? AND (active = 1 OR ? <> 'dou-emperor') ORDER BY stage_order",
          )
          .all(realm.id, realm.code) as Array<Record<string, unknown>>
      ).map((stage) => ({
        id: String(stage.id),
        name: String(stage.name),
        order: Number(stage.stage_order),
        requiredXp: Number(stage.required_xp),
        active: Boolean(stage.active),
        capabilities: (
          database
            .query(
              "SELECT capability_key FROM stage_capabilities WHERE stage_id = ? AND enabled = 1 ORDER BY capability_key",
            )
            .all(stage.id) as Array<{ capability_key: string }>
        ).map((item) => item.capability_key),
      })),
    }));
    const capabilities = (
      database
        .query(
          "SELECT capability_key AS key, label, category, active FROM capability_definitions ORDER BY category, capability_key",
        )
        .all() as Array<{
        key: string;
        label: string;
        category: string;
        active: number;
      }>
    ).map((item) => ({ ...item, active: Boolean(item.active) }));
    const rewards = Object.fromEntries(
      (
        database
          .query(
            "SELECT setting_key, value_json FROM cultivation_settings WHERE setting_key LIKE 'xp.%'",
          )
          .all() as Array<{ setting_key: string; value_json: string }>
      ).map((row) => [row.setting_key, JSON.parse(row.value_json)]),
    );
    return { realms, capabilities, rewards };
  }

  function updateUser(
    adminUserId: string,
    userId: string,
    input: CultivationUserUpdate,
    reason: string,
  ) {
    requireReason(reason);
    return database.transaction(() => {
      ensureUser(userId, false);
      const before = {
        profile: getProfile(userId),
        user: database
          .query(
            "SELECT status, internal_note, public_message FROM users WHERE user_id = ?",
          )
          .get(userId),
      };
      if (input.stageId !== undefined) {
        const target = database
          .query("SELECT id FROM realm_stages WHERE id = ? AND active = 1")
          .get(input.stageId);
        if (!target)
          throw new CultivationError("目标境界不存在", 404, "STAGE_NOT_FOUND");
        database
          .query(
            "UPDATE user_cultivation SET stage_id = ?, pending_stage_id = NULL, updated_at = ? WHERE user_id = ?",
          )
          .run(input.stageId, now().getTime(), userId);
      }
      if (input.currentXp !== undefined)
        database
          .query(
            "UPDATE user_cultivation SET current_xp = ?, updated_at = ? WHERE user_id = ?",
          )
          .run(
            Math.max(0, Math.floor(input.currentXp)),
            now().getTime(),
            userId,
          );
      if (input.dailyLimitOverride !== undefined)
        database
          .query(
            "UPDATE user_cultivation SET daily_limit_override = ?, updated_at = ? WHERE user_id = ?",
          )
          .run(
            input.dailyLimitOverride == null
              ? null
              : Math.max(0, Math.floor(input.dailyLimitOverride)),
            now().getTime(),
            userId,
          );
      if (input.unlimited !== undefined)
        database
          .query(
            "UPDATE user_cultivation SET unlimited_quota = ?, updated_at = ? WHERE user_id = ?",
          )
          .run(input.unlimited ? 1 : 0, now().getTime(), userId);
      if (
        input.status !== undefined ||
        input.internalNote !== undefined ||
        input.publicMessage !== undefined
      ) {
        const user = database
          .query(
            "SELECT status, internal_note, public_message FROM users WHERE user_id = ?",
          )
          .get(userId) as Record<string, unknown>;
        database
          .query(
            "UPDATE users SET status = ?, internal_note = ?, public_message = ? WHERE user_id = ?",
          )
          .run(
            input.status || user.status,
            input.internalNote ?? user.internal_note,
            input.publicMessage ?? user.public_message,
            userId,
          );
      }
      if (input.xpDelta)
        adjustXp(
          database,
          userId,
          Math.trunc(input.xpDelta),
          adminUserId,
          reason,
          now().getTime(),
        );
      const after = {
        profile: getProfile(userId),
        user: database
          .query(
            "SELECT status, internal_note, public_message FROM users WHERE user_id = ?",
          )
          .get(userId),
      };
      audit(
        database,
        adminUserId,
        userId,
        "cultivation.user.update",
        reason,
        before,
        after,
        now().getTime(),
      );
      return after.profile;
    })();
  }

  function approveBreakthrough(
    adminUserId: string,
    userId: string,
    reason: string,
  ) {
    requireReason(reason);
    return database.transaction(() => {
      const current = database
        .query(
          "SELECT stage_id, current_xp, total_xp, pending_stage_id FROM user_cultivation WHERE user_id = ?",
        )
        .get(userId) as {
        stage_id: string;
        current_xp: number;
        total_xp: number;
        pending_stage_id: string | null;
      } | null;
      if (!current?.pending_stage_id)
        throw new CultivationError(
          "当前用户没有待突破境界",
          409,
          "NO_PENDING_BREAKTHROUGH",
        );
      const stage = database
        .query("SELECT required_xp FROM realm_stages WHERE id = ?")
        .get(current.stage_id) as { required_xp: number };
      const stages = database
        .query(
          "SELECT s.id, s.realm_id, s.stage_order, s.required_xp, r.promotion_policy FROM realm_stages s JOIN realms r ON r.id = s.realm_id WHERE s.active = 1 AND r.active = 1 ORDER BY s.stage_order",
        )
        .all() as Array<{
        id: string;
        realm_id: string;
        stage_order: number;
        required_xp: number;
        promotion_policy: "auto" | "manual" | "boundary_manual";
      }>;
      const progressStages: ProgressStage[] = stages.map((item) => ({
        id: item.id,
        realmId: item.realm_id,
        order: item.stage_order,
        requiredXp: item.required_xp,
        promotionPolicy: item.promotion_policy,
      }));
      const advanced = advanceProgress(
        {
          stageId: current.pending_stage_id,
          currentXp: Math.max(0, current.current_xp - stage.required_xp),
          pendingStageId: null,
        },
        progressStages,
      );
      const timestamp = now().getTime();
      database
        .query(
          "UPDATE user_cultivation SET stage_id = ?, current_xp = ?, pending_stage_id = ?, updated_at = ? WHERE user_id = ?",
        )
        .run(
          advanced.stageId,
          advanced.currentXp,
          advanced.pendingStageId,
          timestamp,
          userId,
        );
      database
        .query(
          "UPDATE breakthrough_history SET status = 'approved', approved_by = ?, reason = ? WHERE id = (SELECT id FROM breakthrough_history WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1)",
        )
        .run(adminUserId, reason, userId);
      const insertTransition = database.query(
        "INSERT INTO breakthrough_history(id, user_id, from_stage_id, to_stage_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const [index, transition] of advanced.transitions.entries())
        insertTransition.run(
          randomUUID(),
          userId,
          transition.from,
          transition.to,
          transition.status,
          timestamp + index + 1,
        );
      audit(
        database,
        adminUserId,
        userId,
        "cultivation.breakthrough.approve",
        reason,
        { stageId: current.stage_id },
        { stageId: advanced.stageId, pendingStageId: advanced.pendingStageId },
        timestamp,
      );
      return getProfile(userId);
    })();
  }

  function markBreakthroughSeen(userId: string, breakthroughId: string) {
    database
      .query(
        "UPDATE breakthrough_history SET seen_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(now().getTime(), breakthroughId, userId);
  }

  function updateRealm(
    adminUserId: string,
    realmId: string,
    input: CultivationRealmUpdate,
    reason: string,
  ) {
    requireReason(reason);
    const before = database
      .query("SELECT * FROM realms WHERE id = ?")
      .get(realmId) as Record<string, unknown> | null;
    if (!before)
      throw new CultivationError("境界不存在", 404, "REALM_NOT_FOUND");
    const dailyLimit =
      input.dailyLimit === undefined
        ? before.daily_limit
        : input.dailyLimit == null
          ? null
          : Math.max(0, Math.floor(input.dailyLimit));
    const maxConcurrency =
      input.maxConcurrency === undefined
        ? before.max_concurrency
        : Math.max(1, Math.floor(input.maxConcurrency));
    database
      .query(
        "UPDATE realms SET name=?, color=?, icon_key=?, animation_preset=?, daily_limit=?, max_concurrency=?, promotion_policy=?, active=? WHERE id=?",
      )
      .run(
        input.name ?? before.name,
        input.color ?? before.color,
        input.iconKey ?? before.icon_key,
        input.animationPreset ?? before.animation_preset,
        dailyLimit,
        maxConcurrency,
        input.promotionPolicy ?? before.promotion_policy,
        input.active === undefined ? before.active : input.active ? 1 : 0,
        realmId,
      );
    const after = database
      .query("SELECT * FROM realms WHERE id = ?")
      .get(realmId);
    audit(
      database,
      adminUserId,
      null,
      "cultivation.realm.update",
      reason,
      before,
      after,
      now().getTime(),
    );
    return getConfiguration();
  }

  function updateStage(
    adminUserId: string,
    stageId: string,
    input: CultivationStageUpdate,
    reason: string,
  ) {
    requireReason(reason);
    return database.transaction(() => {
      const before = database
        .query("SELECT * FROM realm_stages WHERE id = ?")
        .get(stageId) as Record<string, unknown> | null;
      if (!before)
        throw new CultivationError("阶段不存在", 404, "STAGE_NOT_FOUND");
      database
        .query(
          "UPDATE realm_stages SET name=?, required_xp=?, active=? WHERE id=?",
        )
        .run(
          input.name ?? before.name,
          input.requiredXp === undefined
            ? before.required_xp
            : Math.max(0, Math.floor(input.requiredXp)),
          input.active === undefined ? before.active : input.active ? 1 : 0,
          stageId,
        );
      if (input.capabilities) {
        database
          .query("DELETE FROM stage_capabilities WHERE stage_id = ?")
          .run(stageId);
        const insert = database.query(
          "INSERT INTO stage_capabilities(stage_id, capability_key, enabled) SELECT ?, capability_key, 1 FROM capability_definitions WHERE capability_key = ?",
        );
        for (const key of [...new Set(input.capabilities)])
          insert.run(stageId, key);
      }
      const after = database
        .query("SELECT * FROM realm_stages WHERE id = ?")
        .get(stageId);
      audit(
        database,
        adminUserId,
        null,
        "cultivation.stage.update",
        reason,
        before,
        after,
        now().getTime(),
      );
      return getConfiguration();
    })();
  }

  function updateRewards(
    adminUserId: string,
    rewards: Record<string, number>,
    reason: string,
  ) {
    requireReason(reason);
    const allowed = ["xp.standard", "xp.hd", "xp.inpaint", "xp.outpaint"];
    const timestamp = now().getTime();
    database.transaction(() => {
      const statement = database.query(
        "INSERT INTO cultivation_settings(setting_key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
      );
      for (const key of allowed)
        if (rewards[key] !== undefined)
          statement.run(
            key,
            JSON.stringify(Math.max(0, Math.floor(rewards[key]))),
            timestamp,
          );
      audit(
        database,
        adminUserId,
        null,
        "cultivation.rewards.update",
        reason,
        {},
        rewards,
        timestamp,
      );
    })();
    return getConfiguration();
  }

  function updateCapability(
    adminUserId: string,
    capabilityKey: string,
    input: CultivationCapabilityUpdate,
    reason: string,
  ) {
    requireReason(reason);
    const before = database
      .query("SELECT * FROM capability_definitions WHERE capability_key = ?")
      .get(capabilityKey) as Record<string, unknown> | null;
    if (!before)
      throw new CultivationError("能力不存在", 404, "CAPABILITY_NOT_FOUND");
    database
      .query(
        "UPDATE capability_definitions SET label = ?, active = ? WHERE capability_key = ?",
      )
      .run(
        input.label ?? before.label,
        input.active === undefined ? before.active : input.active ? 1 : 0,
        capabilityKey,
      );
    const after = database
      .query("SELECT * FROM capability_definitions WHERE capability_key = ?")
      .get(capabilityKey);
    audit(
      database,
      adminUserId,
      null,
      "cultivation.capability.update",
      reason,
      before,
      after,
      now().getTime(),
    );
    return getConfiguration();
  }

  function listUsers(page = 1, pageSize = 20, search = "") {
    const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
    const safePage = Math.max(1, Math.floor(page));
    const pattern = `%${search.trim()}%`;
    const rows = database
      .query(
        "SELECT user_id FROM users WHERE display_name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(pattern, safeSize, (safePage - 1) * safeSize) as Array<{
      user_id: string;
    }>;
    const total = Number(
      (
        database
          .query(
            "SELECT COUNT(*) AS value FROM users WHERE display_name LIKE ?",
          )
          .get(pattern) as { value: number }
      ).value,
    );
    return {
      items: rows.map((row) => ({
        ...getProfile(row.user_id),
        status: String(
          (
            database
              .query("SELECT status FROM users WHERE user_id = ?")
              .get(row.user_id) as { status: string }
          ).status,
        ),
      })),
      page: safePage,
      pageSize: safeSize,
      total,
    };
  }

  function listLedger(userId: string | null, page = 1, pageSize = 20) {
    return paginatedQuery(
      database,
      `SELECT l.*, u.display_name
       FROM cultivation_ledger l
       LEFT JOIN users u ON u.user_id = l.user_id`,
      "cultivation_ledger l",
      userId ? "WHERE l.user_id = ?" : "",
      userId ? [userId] : [],
      "l.created_at",
      page,
      pageSize,
    );
  }

  function listGenerationUsage(userId: string | null, page = 1, pageSize = 20) {
    return paginatedQuery(
      database,
      `SELECT g.*, u.display_name
       FROM generation_usage g
       LEFT JOIN users u ON u.user_id = g.user_id`,
      "generation_usage g",
      userId ? "WHERE g.user_id = ?" : "",
      userId ? [userId] : [],
      "g.created_at",
      page,
      pageSize,
    );
  }

  function listAuditLogs(page = 1, pageSize = 20) {
    return paginatedQuery(
      database,
      `SELECT a.*, admin.display_name AS admin_name, target.display_name AS target_name
       FROM admin_audit_logs a
       LEFT JOIN users admin ON admin.user_id = a.admin_user_id
       LEFT JOIN users target ON target.user_id = a.target_user_id`,
      "admin_audit_logs a",
      "",
      [],
      "a.created_at",
      page,
      pageSize,
    );
  }

  function listLoginLogs(page = 1, pageSize = 20) {
    return paginated(database, "login_logs", "", [], page, pageSize);
  }

  function listBreakthroughs(userId: string | null, page = 1, pageSize = 20) {
    return paginatedQuery(
      database,
      `SELECT h.*, u.display_name, source.name AS from_stage, target.name AS to_stage, approver.display_name AS approved_name
       FROM breakthrough_history h
       LEFT JOIN users u ON u.user_id = h.user_id
       LEFT JOIN realm_stages source ON source.id = h.from_stage_id
       LEFT JOIN realm_stages target ON target.id = h.to_stage_id
       LEFT JOIN users approver ON approver.user_id = h.approved_by`,
      "breakthrough_history h",
      userId ? "WHERE h.user_id = ?" : "",
      userId ? [userId] : [],
      "h.created_at",
      page,
      pageSize,
    );
  }

  function recordLogin(input: {
    userId?: string;
    displayName: string;
    result: string;
    ip: string;
    userAgent: string;
    secret: string;
  }) {
    const hash = createHash("sha256")
      .update(`${input.secret}:${input.ip}`)
      .digest("hex");
    database
      .query(
        "INSERT INTO login_logs(id, user_id, display_name, result, ip_hash, ip_display, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        input.userId || null,
        input.displayName.slice(0, 64),
        input.result.slice(0, 64),
        hash,
        maskIp(input.ip),
        input.userAgent.slice(0, 300),
        now().getTime(),
      );
  }

  return {
    ensureUser,
    getProfile,
    reserveGeneration,
    settleGeneration,
    refundGeneration,
    getConfiguration,
    updateUser,
    approveBreakthrough,
    markBreakthroughSeen,
    updateRealm,
    updateStage,
    updateRewards,
    updateCapability,
    listUsers,
    listLedger,
    listGenerationUsage,
    listAuditLogs,
    listLoginLogs,
    listBreakthroughs,
    recordLogin,
  };
}

function seedDefaults(database: Database) {
  database.transaction(() => {
    const insertRealm = database.query(
      "INSERT OR IGNORE INTO realms(id, theme_key, code, name, color, icon_key, animation_preset, sort_order, daily_limit, max_concurrency, promotion_policy) VALUES (?, 'doupo-default', ?, ?, ?, ?, 'minimal-line', ?, ?, ?, ?)",
    );
    const insertStage = database.query(
      "INSERT OR IGNORE INTO realm_stages(id, realm_id, name, stage_order, required_xp) VALUES (?, ?, ?, ?, ?)",
    );
    let stageOrder = 1;
    for (const [realmIndex, realm] of DEFAULT_REALMS.entries()) {
      const realmId = `realm-${realm.code}`;
      insertRealm.run(
        realmId,
        realm.code,
        realm.name,
        realm.color,
        realm.iconKey,
        realmIndex + 1,
        realm.dailyLimit,
        realm.maxConcurrency,
        realm.promotionPolicy,
      );
      for (
        let stageIndex = 1;
        stageIndex <= realm.stageCount;
        stageIndex += 1
      ) {
        insertStage.run(
          `${realmId}-${stageIndex}`,
          realmId,
          stageLabel(realm, stageIndex),
          stageOrder,
          requiredXp(realmIndex, stageIndex),
        );
        stageOrder += 1;
      }
    }
    const insertCapability = database.query(
      "INSERT OR IGNORE INTO capability_definitions(capability_key, label, category) VALUES (?, ?, ?)",
    );
    for (const capability of DEFAULT_CAPABILITIES)
      insertCapability.run(...capability);
    const allStages = database
      .query("SELECT id, stage_order FROM realm_stages ORDER BY stage_order")
      .all() as Array<{ id: string; stage_order: number }>;
    const insertGrant = database.query(
      "INSERT OR IGNORE INTO stage_capabilities(stage_id, capability_key, enabled) VALUES (?, ?, 1)",
    );
    for (const stage of allStages) {
      for (const key of [
        "generation.references",
        "model.gpt-image",
        "model.gemini",
        "model.flux",
      ])
        insertGrant.run(stage.id, key);
      if (stage.stage_order >= 19) insertGrant.run(stage.id, "generation.hd");
      if (stage.stage_order >= 28)
        for (const key of ["generation.inpaint", "generation.outpaint"])
          insertGrant.run(stage.id, key);
      if (stage.stage_order >= 37)
        for (const key of ["feature.lora", "feature.controlnet"])
          insertGrant.run(stage.id, key);
    }
    const insertSetting = database.query(
      "INSERT OR IGNORE INTO cultivation_settings(setting_key, value_json, updated_at) VALUES (?, ?, ?)",
    );
    for (const [key, value] of Object.entries({
      "xp.standard": 10,
      "xp.hd": 18,
      "xp.inpaint": 12,
      "xp.outpaint": 12,
    }))
      insertSetting.run(key, JSON.stringify(value), Date.now());
  })();
}

function awardXp(
  database: Database,
  userId: string,
  amount: number,
  sourceType: string,
  sourceId: string,
  reason: string,
  timestamp: number,
) {
  const existing = database
    .query(
      "SELECT id FROM cultivation_ledger WHERE user_id = ? AND source_type = ? AND source_id = ?",
    )
    .get(userId, sourceType, sourceId);
  if (existing) return;
  const cultivation = database
    .query(
      "SELECT stage_id, current_xp, total_xp, pending_stage_id FROM user_cultivation WHERE user_id = ?",
    )
    .get(userId) as {
    stage_id: string;
    current_xp: number;
    total_xp: number;
    pending_stage_id: string | null;
  };
  const stages = database
    .query(
      "SELECT s.id, s.realm_id, s.stage_order, s.required_xp, r.promotion_policy FROM realm_stages s JOIN realms r ON r.id = s.realm_id WHERE s.active = 1 AND r.active = 1 ORDER BY s.stage_order",
    )
    .all() as Array<{
    id: string;
    realm_id: string;
    stage_order: number;
    required_xp: number;
    promotion_policy: "auto" | "manual" | "boundary_manual";
  }>;
  const progressStages: ProgressStage[] = stages.map((stage) => ({
    id: stage.id,
    realmId: stage.realm_id,
    order: stage.stage_order,
    requiredXp: stage.required_xp,
    promotionPolicy: stage.promotion_policy,
  }));
  const advanced = advanceProgress(
    {
      stageId: cultivation.stage_id,
      currentXp: cultivation.current_xp + amount,
      pendingStageId: cultivation.pending_stage_id,
    },
    progressStages,
  );
  const totalXp = cultivation.total_xp + amount;
  database
    .query(
      "UPDATE user_cultivation SET stage_id = ?, current_xp = ?, total_xp = ?, pending_stage_id = ?, updated_at = ? WHERE user_id = ?",
    )
    .run(
      advanced.stageId,
      advanced.currentXp,
      totalXp,
      advanced.pendingStageId,
      timestamp,
      userId,
    );
  database
    .query(
      "INSERT INTO cultivation_ledger(id, user_id, amount, balance_after, event_type, source_type, source_id, reason, created_at) VALUES (?, ?, ?, ?, 'XP_GAIN', ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      userId,
      amount,
      totalXp,
      sourceType,
      sourceId,
      reason,
      timestamp,
    );
  const insertTransition = database.query(
    "INSERT INTO breakthrough_history(id, user_id, from_stage_id, to_stage_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const transition of advanced.transitions)
    insertTransition.run(
      randomUUID(),
      userId,
      transition.from,
      transition.to,
      transition.status,
      timestamp,
    );
}

function adjustXp(
  database: Database,
  userId: string,
  amount: number,
  adminUserId: string,
  reason: string,
  timestamp: number,
) {
  if (amount > 0) {
    awardXp(database, userId, amount, "admin", randomUUID(), reason, timestamp);
    return;
  }
  const current = database
    .query(
      "SELECT current_xp, total_xp FROM user_cultivation WHERE user_id = ?",
    )
    .get(userId) as { current_xp: number; total_xp: number };
  const nextTotal = Math.max(0, current.total_xp + amount);
  const applied = nextTotal - current.total_xp;
  const nextCurrent = Math.max(0, current.current_xp + applied);
  database
    .query(
      "UPDATE user_cultivation SET current_xp = ?, total_xp = ?, updated_at = ? WHERE user_id = ?",
    )
    .run(nextCurrent, nextTotal, timestamp, userId);
  database
    .query(
      "INSERT INTO cultivation_ledger(id, user_id, amount, balance_after, event_type, source_type, source_id, operator_user_id, reason, created_at) VALUES (?, ?, ?, ?, 'XP_ADJUST', 'admin', ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      userId,
      applied,
      nextTotal,
      randomUUID(),
      adminUserId,
      reason,
      timestamp,
    );
}

function audit(
  database: Database,
  adminUserId: string,
  targetUserId: string | null,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
  timestamp: number,
) {
  database
    .query(
      "INSERT INTO admin_audit_logs(id, admin_user_id, target_user_id, action, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      adminUserId,
      targetUserId,
      action,
      reason,
      JSON.stringify(before || {}),
      JSON.stringify(after || {}),
      timestamp,
    );
}

function requireReason(reason: string) {
  if (reason.trim().length < 2)
    throw new CultivationError("请填写调整原因", 400, "REASON_REQUIRED");
}

function paginatedQuery(
  database: Database,
  selectFrom: string,
  countFrom: string,
  where: string,
  params: Array<string | number>,
  orderColumn: string,
  page: number,
  pageSize: number,
) {
  if (!/^[a-z_.\s]+$/i.test(orderColumn))
    throw new Error("Invalid order column");
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const items = database
    .query(
      `${selectFrom} ${where} ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, safeSize, (safePage - 1) * safeSize);
  const total = Number(
    (
      database
        .query(`SELECT COUNT(*) AS value FROM ${countFrom} ${where}`)
        .get(...params) as { value: number }
    ).value,
  );
  return { items, page: safePage, pageSize: safeSize, total };
}

function maskIp(ip: string) {
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}:*`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : "unknown";
}

function profileRow(database: Database, userId: string) {
  return database
    .query(
      `
        SELECT u.display_name, u.internal_note, u.public_message, c.*, s.realm_id, s.name AS stage_name, s.stage_order, s.required_xp,
               r.name AS realm_name, r.color, r.icon_key, r.animation_preset, r.daily_limit, r.max_concurrency
        FROM user_cultivation c
        JOIN users u ON u.user_id = c.user_id
        JOIN realm_stages s ON s.id = c.stage_id
        JOIN realms r ON r.id = s.realm_id
        WHERE c.user_id = ?
    `,
    )
    .get(userId) as Record<string, unknown> | null;
}

function settingNumber(database: Database, key: string, fallback: number) {
  const row = database
    .query("SELECT value_json FROM cultivation_settings WHERE setting_key = ?")
    .get(key) as { value_json: string } | null;
  if (!row) return fallback;
  const value = Number(JSON.parse(row.value_json));
  return Number.isFinite(value) ? value : fallback;
}

function dateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

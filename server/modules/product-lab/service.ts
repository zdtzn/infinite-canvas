import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

const PROJECT_STATUSES = new Set([
  "draft",
  "analyzed",
  "planned",
  "completed",
] as const);
const GENERATION_STATUSES = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const);
const OUTPUT_KINDS = new Set([
  "basic_image",
  "main_image",
  "detail_page",
  "selling_poster",
  "scene_image",
] as const);
const ASSET_KEY_PATTERN = /^image:[A-Za-z0-9._:-]{1,180}$/;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_PROJECTS_PER_USER = 200;
const MAX_BATCH_ITEMS = 32;

export type ProductProjectStatus =
  | "draft"
  | "analyzed"
  | "planned"
  | "completed";
export type ProductGenerationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";
export type ProductOutputKind =
  | "basic_image"
  | "main_image"
  | "detail_page"
  | "selling_poster"
  | "scene_image";

const PRODUCT_OUTPUT_CAPABILITIES: Record<ProductOutputKind, string> = {
  basic_image: "product.basic",
  main_image: "product.main_image",
  detail_page: "product.detail_page",
  selling_poster: "product.analysis",
  scene_image: "product.main_image",
};

export function productOutputCapability(value: unknown) {
  if (typeof value !== "string" || !OUTPUT_KINDS.has(value as ProductOutputKind))
    return null;
  return PRODUCT_OUTPUT_CAPABILITIES[value as ProductOutputKind];
}

export type ProductProject = {
  id: string;
  title: string;
  platform: string;
  styleKey: string;
  status: ProductProjectStatus;
  sourceAssetKey: string;
  brandName: string;
  analysis: Record<string, unknown>;
  plan: unknown[];
  createdAt: number;
  updatedAt: number;
};

export type ProductGeneration = {
  id: string;
  projectId: string;
  outputKind: ProductOutputKind;
  pageIndex: number;
  prompt: string;
  jobId?: string;
  assetKey?: string;
  status: ProductGenerationStatus;
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type ProductBatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type ProductBatch = {
  id: string;
  projectId: string;
  status: ProductBatchStatus;
  total: number;
  completed: number;
  failed: number;
  canceled: number;
  createdAt: number;
  updatedAt: number;
};

export type ProductBatchItem = {
  id: string;
  batchId: string;
  generationId: string;
  jobId?: string;
  status: ProductGenerationStatus;
  error: string;
  generation: ProductGeneration;
};

export type ProductTemplate = {
  id: string;
  platform: string;
  name: string;
  outputKind: ProductOutputKind;
  styleKey: string;
  aspectRatio: string;
  promptTemplate: string;
};

export class ProductLabError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "PRODUCT_LAB_INVALID",
  ) {
    super(message);
    this.name = "ProductLabError";
  }
}

export function createProductLabService(
  database: Database,
  options: { now?: () => number } = {},
) {
  const now = options.now || Date.now;

  function listProjects(userId: string) {
    return (
      database
        .query(
          "SELECT * FROM product_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
        )
        .all(userId, MAX_PROJECTS_PER_USER) as ProductProjectRow[]
    ).map(projectFromRow);
  }

  function getProject(userId: string, projectId: string) {
    const row = database
      .query(
        "SELECT * FROM product_projects WHERE user_id = ? AND project_id = ?",
      )
      .get(
        userId,
        validId(projectId, "商品项目 ID"),
      ) as ProductProjectRow | null;
    return row ? projectFromRow(row) : null;
  }

  function createProject(userId: string, input: unknown) {
    const source = inputRecord(input, "商品项目内容无效");
    const count = Number(
      (
        database
          .query(
            "SELECT COUNT(*) AS count FROM product_projects WHERE user_id = ?",
          )
          .get(userId) as { count: number }
      ).count,
    );
    if (count >= MAX_PROJECTS_PER_USER)
      throw new ProductLabError("商品项目数量已达上限", 409, "PROJECT_LIMIT");

    const timestamp = now();
    const project: ProductProject = {
      id: randomUUID(),
      title: requiredText(source.title, 120, "请输入商品名称"),
      platform: safeSlug(source.platform || "pinduoduo", "商品平台"),
      styleKey: safeSlug(source.styleKey || "clean", "视觉风格"),
      status: "draft",
      sourceAssetKey: ownedImageAsset(database, userId, source.sourceAssetKey),
      brandName: optionalText(source.brandName, 120),
      analysis: {},
      plan: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database
      .query(
        "INSERT INTO product_projects(user_id, project_id, title, platform, style_key, status, source_asset_key, brand_name, analysis_json, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?)",
      )
      .run(
        userId,
        project.id,
        project.title,
        project.platform,
        project.styleKey,
        project.status,
        project.sourceAssetKey,
        project.brandName,
        timestamp,
        timestamp,
      );
    return project;
  }

  function updateProject(userId: string, projectId: string, input: unknown) {
    const source = inputRecord(input, "商品项目内容无效");
    const current = requireProject(userId, projectId);
    const status =
      source.status === undefined
        ? current.status
        : enumValue(source.status, PROJECT_STATUSES, "商品项目状态无效");
    const analysis =
      source.analysis === undefined
        ? current.analysis
        : jsonObject(source.analysis, 96 * 1024, "商品分析内容无效");
    const plan =
      source.plan === undefined
        ? current.plan
        : jsonArray(source.plan, 256 * 1024, "商品规划内容无效");
    const next: ProductProject = {
      ...current,
      title:
        source.title === undefined
          ? current.title
          : requiredText(source.title, 120, "请输入商品名称"),
      platform:
        source.platform === undefined
          ? current.platform
          : safeSlug(source.platform, "商品平台"),
      styleKey:
        source.styleKey === undefined
          ? current.styleKey
          : safeSlug(source.styleKey, "视觉风格"),
      status,
      sourceAssetKey:
        source.sourceAssetKey === undefined
          ? current.sourceAssetKey
          : ownedImageAsset(database, userId, source.sourceAssetKey),
      brandName:
        source.brandName === undefined
          ? current.brandName
          : optionalText(source.brandName, 120),
      analysis,
      plan,
      updatedAt: now(),
    };
    database
      .query(
        "UPDATE product_projects SET title = ?, platform = ?, style_key = ?, status = ?, source_asset_key = ?, brand_name = ?, analysis_json = ?, plan_json = ?, updated_at = ? WHERE user_id = ? AND project_id = ?",
      )
      .run(
        next.title,
        next.platform,
        next.styleKey,
        next.status,
        next.sourceAssetKey,
        next.brandName,
        JSON.stringify(next.analysis),
        JSON.stringify(next.plan),
        next.updatedAt,
        userId,
        next.id,
      );
    return next;
  }

  function deleteProject(userId: string, projectId: string) {
    const result = database
      .query(
        "DELETE FROM product_projects WHERE user_id = ? AND project_id = ?",
      )
      .run(userId, validId(projectId, "商品项目 ID"));
    if (!result.changes)
      throw new ProductLabError("商品项目不存在", 404, "PROJECT_NOT_FOUND");
  }

  function listGenerations(userId: string, projectId: string) {
    if (!getProject(userId, projectId)) return [];
    return (
      database
        .query(
          "SELECT * FROM product_generations WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC, page_index ASC",
        )
        .all(
          userId,
          validId(projectId, "商品项目 ID"),
        ) as ProductGenerationRow[]
    ).map(generationFromRow);
  }

  function saveGeneration(userId: string, input: unknown) {
    const source = inputRecord(input, "商品生成记录无效");
    const project = requireProject(
      userId,
      validId(source.projectId, "商品项目 ID"),
    );
    const status = enumValue(
      source.status,
      GENERATION_STATUSES,
      "商品生成状态无效",
    );
    const jobId = optionalId(source.jobId, "生成任务 ID");
    const assetKey = source.assetKey
      ? ownedImageAsset(database, userId, source.assetKey)
      : undefined;
    if (jobId && !ownedJob(database, userId, jobId))
      throw new ProductLabError(
        "生成任务不存在或不属于当前用户",
        400,
        "JOB_NOT_OWNED",
      );
    if (status === "succeeded" && !assetKey)
      throw new ProductLabError(
        "成功的商品生成记录必须包含结果素材",
        400,
        "ASSET_REQUIRED",
      );

    const timestamp = now();
    const generation: ProductGeneration = {
      id: randomUUID(),
      projectId: project.id,
      outputKind: enumValue(
        source.outputKind,
        OUTPUT_KINDS,
        "商品输出类型无效",
      ),
      pageIndex: boundedInteger(source.pageIndex, 0, 99),
      prompt: requiredText(source.prompt, 20_000, "商品生成提示词不能为空"),
      jobId,
      assetKey,
      status,
      error: optionalText(source.error, 1_000),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database
      .query(
        "INSERT INTO product_generations(user_id, generation_id, project_id, output_kind, page_index, prompt, job_id, asset_key, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        userId,
        generation.id,
        generation.projectId,
        generation.outputKind,
        generation.pageIndex,
        generation.prompt,
        generation.jobId || null,
        generation.assetKey || null,
        generation.status,
        generation.error,
        timestamp,
        timestamp,
      );
    return generation;
  }

  function createBatch(userId: string, input: unknown) {
    const source = inputRecord(input, "商品批任务内容无效");
    const batchId = validId(source.batchId, "商品批任务 ID");
    const project = requireProject(userId, validId(source.projectId, "商品项目 ID"));
    const rawItems = Array.isArray(source.items) ? source.items : [];
    if (!rawItems.length || rawItems.length > MAX_BATCH_ITEMS)
      throw new ProductLabError(`一次最多提交 ${MAX_BATCH_ITEMS} 幅商品画卷`);
    const existing = getBatch(userId, batchId);
    if (existing) return existing;

    const timestamp = now();
    const batch: ProductBatch = {
      id: batchId,
      projectId: project.id,
      status: "queued",
      total: rawItems.length,
      completed: 0,
      failed: 0,
      canceled: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const generations: ProductGeneration[] = [];
    database.transaction(() => {
      database
        .query(
          "INSERT INTO product_batch_jobs(user_id, batch_id, project_id, status, total, completed, failed, canceled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)",
        )
        .run(userId, batch.id, project.id, batch.status, batch.total, timestamp, timestamp);
      const insertGeneration = database.query(
        "INSERT INTO product_generations(user_id, generation_id, project_id, output_kind, page_index, prompt, job_id, asset_key, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending', '', ?, ?)",
      );
      const insertItem = database.query(
        "INSERT INTO product_batch_items(user_id, batch_id, item_id, generation_id, job_id, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?)",
      );
      for (const rawItem of rawItems) {
        const item = inputRecord(rawItem, "商品批任务项目无效");
        const generationId = validId(item.generationId, "商品生成记录 ID");
        const jobId = optionalId(item.jobId, "生成任务 ID");
        const generation: ProductGeneration = {
          id: generationId,
          projectId: project.id,
          outputKind: enumValue(item.outputKind, OUTPUT_KINDS, "商品输出类型无效"),
          pageIndex: boundedInteger(item.pageIndex, 0, 99),
          prompt: requiredText(item.prompt, 20_000, "商品生成提示词不能为空"),
          jobId,
          status: "pending",
          error: "",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        generations.push(generation);
        insertGeneration.run(
          userId,
          generation.id,
          generation.projectId,
          generation.outputKind,
          generation.pageIndex,
          generation.prompt,
          generation.jobId || null,
          timestamp,
          timestamp,
        );
        insertItem.run(userId, batch.id, validId(item.itemId || randomUUID(), "商品批任务项目 ID"), generation.id, generation.jobId || null, timestamp, timestamp);
      }
    })();
    return { batch, items: generations.map((generation) => batchItemFromGeneration(batch.id, generation)) };
  }

  function getBatch(userId: string, batchId: string) {
    const id = validId(batchId, "商品批任务 ID");
    const row = database
      .query("SELECT * FROM product_batch_jobs WHERE user_id = ? AND batch_id = ?")
      .get(userId, id) as ProductBatchRow | null;
    if (!row) return null;
    const items = database
      .query(
        "SELECT bi.item_id, bi.batch_id, bi.generation_id, bi.job_id AS item_job_id, bi.status AS item_status, bi.error AS item_error, pg.* FROM product_batch_items bi JOIN product_generations pg ON pg.user_id = bi.user_id AND pg.generation_id = bi.generation_id WHERE bi.user_id = ? AND bi.batch_id = ? ORDER BY pg.created_at ASC, pg.page_index ASC",
      )
      .all(userId, id) as ProductBatchItemRow[];
    return {
      batch: batchFromRow(row),
      items: items.map((item) => ({
        id: item.item_id,
        batchId: item.batch_id,
        generationId: item.generation_id,
        jobId: item.item_job_id || undefined,
        status: item.item_status,
        error: item.item_error,
        generation: generationFromRow(item),
      })),
    };
  }

  function listBatches(userId: string, projectId?: string) {
    const rows = projectId
      ? (database
          .query("SELECT * FROM product_batch_jobs WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20")
          .all(userId, validId(projectId, "商品项目 ID")) as ProductBatchRow[])
      : (database
          .query("SELECT * FROM product_batch_jobs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20")
          .all(userId) as ProductBatchRow[]);
    return rows.map((row) => getBatch(userId, row.batch_id)!).filter(Boolean);
  }

  function cancelBatch(userId: string, batchId: string) {
    const id = validId(batchId, "商品批任务 ID");
    const batch = getBatch(userId, id);
    if (!batch) throw new ProductLabError("商品批任务不存在", 404, "BATCH_NOT_FOUND");
    const activeItems = batch.items.filter((item) => ["pending", "running"].includes(item.status));
    if (!activeItems.length) return batch;
    const timestamp = now();
    database.transaction(() => {
      database
        .query("UPDATE product_batch_items SET status = 'canceled', error = ?, updated_at = ? WHERE user_id = ? AND batch_id = ? AND status IN ('pending', 'running')")
        .run("用户已取消商品套图", timestamp, userId, id);
      database
        .query("UPDATE product_generations SET status = 'canceled', error = ?, updated_at = ? WHERE user_id = ? AND generation_id IN (SELECT generation_id FROM product_batch_items WHERE user_id = ? AND batch_id = ? AND status = 'canceled')")
        .run("用户已取消商品套图", timestamp, userId, userId, id);
      const counts = database
        .query("SELECT COUNT(*) AS total, SUM(status = 'succeeded') AS completed, SUM(status = 'failed') AS failed, SUM(status = 'canceled') AS canceled FROM product_batch_items WHERE user_id = ? AND batch_id = ?")
        .get(userId, id) as { total: number; completed: number; failed: number; canceled: number };
      database
        .query("UPDATE product_batch_jobs SET status = 'canceled', total = ?, completed = ?, failed = ?, canceled = ?, updated_at = ? WHERE user_id = ? AND batch_id = ?")
        .run(counts.total, counts.completed || 0, counts.failed || 0, counts.canceled || 0, timestamp, userId, id);
    })();
    return getBatch(userId, id)!;
  }

  function retryFailedBatch(userId: string, input: unknown) {
    const source = inputRecord(input, "商品批任务重试内容无效");
    const batchId = validId(source.batchId, "商品批任务 ID");
    const batch = getBatch(userId, batchId);
    if (!batch) throw new ProductLabError("商品批任务不存在", 404, "BATCH_NOT_FOUND");
    const requestedItems = Array.isArray(source.items) ? source.items : [];
    const failedItems = batch.items.filter((item) => item.status === "failed");
    const selected = requestedItems.length
      ? requestedItems.map((rawItem) => {
          const item = inputRecord(rawItem, "商品批任务重试项目无效");
          const generationId = validId(item.generationId, "商品生成记录 ID");
          const current = failedItems.find((candidate) => candidate.generationId === generationId);
          if (!current) throw new ProductLabError("只能重试当前批次中失败的商品画卷", 409, "BATCH_RETRY_ITEM_INVALID");
          return { generationId, jobId: validId(item.jobId, "生成任务 ID") };
        })
      : failedItems.map((item) => ({ generationId: item.generationId, jobId: validId(item.jobId || "", "生成任务 ID") }));
    if (!selected.length) throw new ProductLabError("当前批次没有可重试的失败画卷", 409, "BATCH_NOT_RETRYABLE");
    const unique = new Set(selected.map((item) => item.generationId));
    if (unique.size !== selected.length) throw new ProductLabError("商品批任务重试项目不能重复");
    const timestamp = now();
    database.transaction(() => {
      for (const item of selected) {
        database
          .query("UPDATE product_batch_items SET job_id = ?, status = 'pending', error = '', updated_at = ? WHERE user_id = ? AND batch_id = ? AND generation_id = ? AND status = 'failed'")
          .run(item.jobId, timestamp, userId, batchId, item.generationId);
        database
          .query("UPDATE product_generations SET job_id = ?, status = 'pending', asset_key = NULL, error = '', updated_at = ? WHERE user_id = ? AND generation_id = ?")
          .run(item.jobId, timestamp, userId, item.generationId);
      }
      const counts = database
        .query("SELECT COUNT(*) AS total, SUM(status = 'succeeded') AS completed, SUM(status = 'failed') AS failed, SUM(status = 'canceled') AS canceled FROM product_batch_items WHERE user_id = ? AND batch_id = ?")
        .get(userId, batchId) as { total: number; completed: number; failed: number; canceled: number };
      database
        .query("UPDATE product_batch_jobs SET status = 'queued', total = ?, completed = ?, failed = ?, canceled = ?, updated_at = ? WHERE user_id = ? AND batch_id = ?")
        .run(counts.total, counts.completed || 0, counts.failed || 0, counts.canceled || 0, timestamp, userId, batchId);
    })();
    return getBatch(userId, batchId)!;
  }

  function updateBatchItem(userId: string, input: unknown) {
    const source = inputRecord(input, "商品批任务更新无效");
    const batchId = validId(source.batchId, "商品批任务 ID");
    const generationId = validId(source.generationId, "商品生成记录 ID");
    const status = enumValue(source.status, GENERATION_STATUSES, "商品生成状态无效");
    const expectedJobId = optionalId(source.jobId, "生成任务 ID");
    const assetKey = source.assetKey ? ownedImageAsset(database, userId, source.assetKey) : undefined;
    if (status === "succeeded" && !assetKey) throw new ProductLabError("成功的商品生成记录必须包含结果素材", 400, "ASSET_REQUIRED");
    const batch = getBatch(userId, batchId);
    const item = batch?.items.find((candidate) => candidate.generationId === generationId);
    if (!batch || !item) throw new ProductLabError("商品批任务不存在", 404, "BATCH_NOT_FOUND");
    if (expectedJobId && item.jobId !== expectedJobId) throw new ProductLabError("商品生成任务关联不一致", 409, "BATCH_JOB_MISMATCH");
    if (item.status === status) return batch;
    if (["succeeded", "failed", "canceled"].includes(item.status)) throw new ProductLabError("商品批任务项目已经结束", 409, "BATCH_ITEM_TERMINAL");
    if (item.status === "running" && status === "pending") throw new ProductLabError("商品批任务状态不能回退", 409, "BATCH_ITEM_STATE_REGRESSION");
    const timestamp = now();
    const error = optionalText(source.error, 1_000);
    const nextAssetKey = assetKey || item.generation.assetKey || undefined;
    database.transaction(() => {
      database
        .query("UPDATE product_batch_items SET status = ?, error = ?, updated_at = ? WHERE user_id = ? AND batch_id = ? AND generation_id = ?")
        .run(status, error, timestamp, userId, batchId, generationId);
      database
        .query("UPDATE product_generations SET status = ?, asset_key = ?, error = ?, updated_at = ? WHERE user_id = ? AND generation_id = ?")
        .run(status, nextAssetKey || null, error, timestamp, userId, generationId);
      const counts = database
        .query("SELECT COUNT(*) AS total, SUM(status = 'succeeded') AS completed, SUM(status = 'failed') AS failed, SUM(status = 'canceled') AS canceled, SUM(status IN ('pending', 'running')) AS active FROM product_batch_items WHERE user_id = ? AND batch_id = ?")
        .get(userId, batchId) as { total: number; completed: number; failed: number; canceled: number; active: number };
      const nextStatus: ProductBatchStatus = Number(counts.active) > 0
        ? "running"
        : Number(counts.completed) > 0
          ? "completed"
          : Number(counts.canceled) === Number(counts.total)
            ? "canceled"
            : "failed";
      database
        .query("UPDATE product_batch_jobs SET status = ?, total = ?, completed = ?, failed = ?, canceled = ?, updated_at = ? WHERE user_id = ? AND batch_id = ?")
        .run(nextStatus, counts.total, counts.completed || 0, counts.failed || 0, counts.canceled || 0, timestamp, userId, batchId);
    })();
    return getBatch(userId, batchId)!;
  }

  function listTemplates(platform = "pinduoduo") {
    return (
      database
        .query(
          "SELECT * FROM product_templates WHERE platform = ? AND active = 1 ORDER BY sort_order, template_id",
        )
        .all(safeSlug(platform, "商品平台")) as ProductTemplateRow[]
    ).map(templateFromRow);
  }

  function hasCapability(userId: string, capabilityKey: string) {
    return Boolean(
      database
        .query(
          "SELECT 1 FROM user_cultivation uc JOIN stage_capabilities sc ON sc.stage_id = uc.stage_id JOIN capability_definitions cd ON cd.capability_key = sc.capability_key WHERE uc.user_id = ? AND sc.capability_key = ? AND sc.enabled = 1 AND cd.active = 1",
        )
        .get(userId, capabilityKey),
    );
  }

  function assetReferenceRoots(userId: string) {
    const projects = database
      .query("SELECT source_asset_key FROM product_projects WHERE user_id = ?")
      .all(userId) as Array<{ source_asset_key: string }>;
    const generations = database
      .query(
        "SELECT asset_key FROM product_generations WHERE user_id = ? AND asset_key IS NOT NULL",
      )
      .all(userId) as Array<{ asset_key: string }>;
    return [
      ...projects.map((item) => ({ storageKey: item.source_asset_key })),
      ...generations.map((item) => ({ storageKey: item.asset_key })),
    ];
  }

  function requireProject(userId: string, projectId: string) {
    const project = getProject(userId, projectId);
    if (!project)
      throw new ProductLabError("商品项目不存在", 404, "PROJECT_NOT_FOUND");
    return project;
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    listGenerations,
    saveGeneration,
    createBatch,
    getBatch,
    listBatches,
    cancelBatch,
    retryFailedBatch,
    updateBatchItem,
    listTemplates,
    hasCapability,
    assetReferenceRoots,
  };
}

type ProductProjectRow = {
  project_id: string;
  title: string;
  platform: string;
  style_key: string;
  status: ProductProjectStatus;
  source_asset_key: string;
  brand_name: string;
  analysis_json: string;
  plan_json: string;
  created_at: number;
  updated_at: number;
};

type ProductGenerationRow = {
  generation_id: string;
  project_id: string;
  output_kind: ProductOutputKind;
  page_index: number;
  prompt: string;
  job_id: string | null;
  asset_key: string | null;
  status: ProductGenerationStatus;
  error: string;
  created_at: number;
  updated_at: number;
};

type ProductBatchRow = {
  batch_id: string;
  project_id: string;
  status: ProductBatchStatus;
  total: number;
  completed: number;
  failed: number;
  canceled: number;
  created_at: number;
  updated_at: number;
};

type ProductBatchItemRow = ProductGenerationRow & {
  item_id: string;
  batch_id: string;
  generation_id: string;
  item_job_id: string | null;
  item_status: ProductGenerationStatus;
  item_error: string;
};

type ProductTemplateRow = {
  template_id: string;
  platform: string;
  name: string;
  output_kind: ProductOutputKind;
  style_key: string;
  aspect_ratio: string;
  prompt_template: string;
};

function projectFromRow(row: ProductProjectRow): ProductProject {
  return {
    id: row.project_id,
    title: row.title,
    platform: row.platform,
    styleKey: row.style_key,
    status: row.status,
    sourceAssetKey: row.source_asset_key,
    brandName: row.brand_name,
    analysis: parseRecord(row.analysis_json),
    plan: parseArray(row.plan_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function generationFromRow(row: ProductGenerationRow): ProductGeneration {
  return {
    id: row.generation_id,
    projectId: row.project_id,
    outputKind: row.output_kind,
    pageIndex: Number(row.page_index),
    prompt: row.prompt,
    jobId: row.job_id || undefined,
    assetKey: row.asset_key || undefined,
    status: row.status,
    error: row.error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function batchFromRow(row: ProductBatchRow): ProductBatch {
  return {
    id: row.batch_id,
    projectId: row.project_id,
    status: row.status,
    total: Number(row.total),
    completed: Number(row.completed),
    failed: Number(row.failed),
    canceled: Number(row.canceled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function batchItemFromGeneration(batchId: string, generation: ProductGeneration): ProductBatchItem {
  return {
    id: randomUUID(),
    batchId,
    generationId: generation.id,
    jobId: generation.jobId,
    status: generation.status,
    error: generation.error,
    generation,
  };
}

function templateFromRow(row: ProductTemplateRow): ProductTemplate {
  return {
    id: row.template_id,
    platform: row.platform,
    name: row.name,
    outputKind: row.output_kind,
    styleKey: row.style_key,
    aspectRatio: row.aspect_ratio,
    promptTemplate: row.prompt_template,
  };
}

function ownedImageAsset(database: Database, userId: string, value: unknown) {
  const assetKey = String(value || "").trim();
  if (!ASSET_KEY_PATTERN.test(assetKey))
    throw new ProductLabError("商品图片素材无效");
  const asset = database
    .query("SELECT mime_type FROM assets WHERE user_id = ? AND asset_key = ?")
    .get(userId, assetKey) as { mime_type: string } | null;
  if (!asset || !String(asset.mime_type).startsWith("image/"))
    throw new ProductLabError(
      "商品图片不存在或不属于当前用户",
      400,
      "ASSET_NOT_OWNED",
    );
  return assetKey;
}

function ownedJob(database: Database, userId: string, jobId: string) {
  return database
    .query("SELECT 1 FROM jobs WHERE user_id = ? AND id = ?")
    .get(userId, jobId);
}

function requiredText(value: unknown, max: number, message: string) {
  const text = String(value || "").trim();
  if (!text || text.length > max || hasUnsafeControl(text))
    throw new ProductLabError(message);
  return text;
}

function inputRecord(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProductLabError(message);
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, max: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > max || hasUnsafeControl(text))
    throw new ProductLabError("输入内容过长或包含无效字符");
  return text;
}

function validId(value: unknown, label: string) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id))
    throw new ProductLabError(`${label} 无效`);
  return id;
}

function optionalId(value: unknown, label: string) {
  const id = String(value || "").trim();
  return id ? validId(id, label) : undefined;
}

function safeSlug(value: unknown, label: string) {
  const slug = String(value || "")
    .trim()
    .toLowerCase();
  if (!SAFE_SLUG_PATTERN.test(slug)) throw new ProductLabError(`${label}无效`);
  return slug;
}

function boundedInteger(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  message: string,
) {
  const normalized = String(value || "") as T;
  if (!allowed.has(normalized)) throw new ProductLabError(message);
  return normalized;
}

function jsonObject(value: unknown, maxBytes: number, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProductLabError(message);
  assertJsonSize(value, maxBytes, message);
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown, maxBytes: number, message: string) {
  if (!Array.isArray(value)) throw new ProductLabError(message);
  assertJsonSize(value, maxBytes, message);
  return value;
}

function assertJsonSize(value: unknown, maxBytes: number, message: string) {
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ProductLabError(message);
  }
  if (Buffer.byteLength(serialized) > maxBytes)
    throw new ProductLabError(message);
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasUnsafeControl(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

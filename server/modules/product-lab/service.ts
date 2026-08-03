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

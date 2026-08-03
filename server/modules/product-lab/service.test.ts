import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import { createCultivationService } from "../cultivation/service";
import type { ServerState, StoredImageJob } from "../../types";
import {
  ProductLabError,
  createProductLabService,
  productOutputCapability,
} from "./service";

const directories: string[] = [];

afterEach(() => {
  while (directories.length) {
    try {
      rmSync(directories.pop()!, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
  }
});

describe("product lab persistence and capabilities", () => {
  test("maps only supported product outputs to cultivation capabilities", () => {
    expect(productOutputCapability("basic_image")).toBe("product.basic");
    expect(productOutputCapability("detail_page")).toBe(
      "product.detail_page",
    );
    expect(productOutputCapability("unknown")).toBeNull();
  });

  test("grants product capabilities progressively through the existing cultivation system", () => {
    const { store, cultivation } = setup();
    try {
      const configuration = cultivation.getConfiguration();
      const capabilities = new Set(
        configuration.capabilities.map((capability) => capability.key),
      );
      expect(capabilities).toEqual(
        expect.objectContaining(
          new Set([
            "product.basic",
            "product.analysis",
            "product.main_image",
            "product.detail_page",
            "product.multi_style",
            "product.batch_generate",
            "product.brand_design",
          ]),
        ),
      );

      const firstStageCapabilities = (realmCode: string) =>
        configuration.realms.find((realm) => realm.code === realmCode)!
          .stages[0].capabilities;

      expect(firstStageCapabilities("dou-qi")).toContain("product.basic");
      expect(firstStageCapabilities("dou-zhe")).toContain("product.main_image");
      expect(firstStageCapabilities("dou-shi")).toContain("product.analysis");
      expect(firstStageCapabilities("da-dou-shi")).toContain(
        "product.detail_page",
      );
      expect(firstStageCapabilities("dou-wang")).toContain(
        "product.multi_style",
      );
      expect(firstStageCapabilities("dou-zong")).toContain(
        "product.batch_generate",
      );
      expect(firstStageCapabilities("dou-zun")).toContain(
        "product.brand_design",
      );
      expect(firstStageCapabilities("dou-emperor")).toEqual(
        expect.arrayContaining([
          "product.basic",
          "product.analysis",
          "product.main_image",
          "product.detail_page",
          "product.multi_style",
          "product.batch_generate",
          "product.brand_design",
        ]),
      );
    } finally {
      store.close();
    }
  });

  test("keeps projects and generation references isolated by user", () => {
    const { store, productLab } = setup();
    try {
      insertAsset(store.raw!, "user-a", "image:source-a");
      insertAsset(store.raw!, "user-b", "image:source-b");
      insertAsset(store.raw!, "user-a", "image:result-a");
      insertJob(store.raw!, "user-a", "job-a");

      const project = productLab.createProject("user-a", {
        title: "白瓷茶杯",
        platform: "pinduoduo",
        styleKey: "clean",
        sourceAssetKey: "image:source-a",
      });

      expect(productLab.getProject("user-a", project.id)?.title).toBe(
        "白瓷茶杯",
      );
      expect(productLab.getProject("user-b", project.id)).toBeNull();
      expect(() =>
        productLab.updateProject("user-b", project.id, {
          title: "越权修改",
        }),
      ).toThrow(ProductLabError);

      const generation = productLab.saveGeneration("user-a", {
        projectId: project.id,
        outputKind: "main_image",
        pageIndex: 0,
        prompt: "白瓷茶杯，干净电商主图",
        jobId: "job-a",
        assetKey: "image:result-a",
        status: "succeeded",
      });

      expect(generation.jobId).toBe("job-a");
      expect(generation.assetKey).toBe("image:result-a");
      expect(productLab.listGenerations("user-a", project.id)).toHaveLength(1);
      expect(productLab.listGenerations("user-b", project.id)).toEqual([]);
      expect(() =>
        productLab.saveGeneration("user-a", {
          projectId: project.id,
          outputKind: "scene_image",
          pageIndex: 0,
          prompt: "错误引用",
          assetKey: "image:source-b",
          status: "succeeded",
        }),
      ).toThrow(ProductLabError);
    } finally {
      store.close();
    }
  });

  test("rejects malformed project payloads as product input errors", () => {
    const { store, productLab } = setup();
    try {
      expect(() => productLab.createProject("user-a", null as never)).toThrow(
        ProductLabError,
      );
      expect(() => productLab.createProject("user-a", [] as never)).toThrow(
        ProductLabError,
      );
    } finally {
      store.close();
    }
  });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "product-lab-"));
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
      "user-a": { userId: "user-a", displayName: "User A", createdAt: 1 },
      "user-b": { userId: "user-b", displayName: "User B", createdAt: 1 },
    },
    channels: {},
    assets: {},
    jobs: {},
    projects: {},
    projectTombstones: {},
  };
  store.saveState(state);
  const cultivation = createCultivationService(store.raw!);
  const productLab = createProductLabService(store.raw!);
  return { store, cultivation, productLab };
}

function insertAsset(
  database: NonNullable<ReturnType<typeof openAppDatabase>["raw"]>,
  userId: string,
  assetKey: string,
) {
  database
    .query(
      "INSERT INTO assets(asset_key, user_id, mime_type, bytes, created_at) VALUES (?, ?, 'image/png', 100, ?)",
    )
    .run(assetKey, userId, Date.now());
}

function insertJob(
  database: NonNullable<ReturnType<typeof openAppDatabase>["raw"]>,
  userId: string,
  jobId: string,
) {
  const job: StoredImageJob = {
    id: jobId,
    status: "succeeded",
    createdAt: Date.now(),
    input: {
      userId,
      channelId: "channel",
      apiFormat: "openai",
      model: "gpt-image-2",
      prompt: "product",
      count: 1,
      references: [],
    },
  };
  database
    .query(
      "INSERT INTO jobs(id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(jobId, userId, JSON.stringify(job), job.createdAt);
}

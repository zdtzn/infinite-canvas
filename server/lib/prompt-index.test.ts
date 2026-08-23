import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../db/database";
import {
  normalizePromptIndexItems,
  normalizePromptSourceIndexItems,
  normalizeStoredPromptIndexTaxonomy,
  queryPromptIndex,
  replacePromptIndex,
} from "./prompt-index";

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

describe("prompt index", () => {
  test("supports bounded search, tag filtering and pagination", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-index-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const items = normalizePromptIndexItems("builtin", [
        {
          id: "one",
          title: "国风山水",
          prompt: "青山云海",
          tags: ["国风", "风景"],
          category: "插画",
        },
        {
          id: "two",
          title: "电商主图",
          prompt: "白底商品主图",
          tags: ["电商"],
          category: "商品",
        },
        {
          id: "three",
          title: "国风人物",
          prompt: "古典人物立绘",
          tags: ["国风", "人物"],
          category: "插画",
        },
      ]);
      replacePromptIndex(store.raw!, "builtin", items);

      expect(
        queryPromptIndex(store.raw!, { page: 1, pageSize: 2 }),
      ).toMatchObject({
        total: 3,
        items: expect.any(Array),
        page: 1,
        pageSize: 2,
        indexed: true,
      });
      expect(
        queryPromptIndex(store.raw!, { tags: ["国风东方"] })
          .items.map((item) => item.id)
          .sort(),
      ).toEqual(["one", "three"]);
      expect(
        queryPromptIndex(store.raw!, { category: "商品" }).items.map(
          (item) => item.id,
        ),
      ).toEqual(["two"]);
      expect(queryPromptIndex(store.raw!).tags.sort()).toEqual(["国风东方", "商品商业"].sort());
      expect(
        queryPromptIndex(store.raw!, { keyword: "主图" }).items.map(
          (item) => item.id,
        ),
      ).toEqual(["two"]);
      expect(
        queryPromptIndex(store.raw!, { page: 2, pageSize: 2 }).items,
      ).toHaveLength(1);
      expect(queryPromptIndex(store.raw!, { keyword: "不存在的内容" })).toMatchObject({
        items: [],
        total: 0,
        indexed: true,
      });
    } finally {
      store.close();
    }
  });

  test("migrates noisy stored tags to one stable primary theme", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-taxonomy-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      store.raw!
        .query("INSERT INTO prompt_index(source_id, prompt_id, title, prompt, cover_url, preview, tags_json, category, github_url, created_at, updated_at, indexed_at) VALUES (?, ?, ?, ?, '', '', ?, ?, '', '', '', ?)")
        .run("legacy", "one", "国风茶具电商主图", "commercial product photography with ink wash details", JSON.stringify(["gpt-image-2", "作者", "电商设计"]), "旧来源", Date.now());

      expect(normalizeStoredPromptIndexTaxonomy(store.raw!)).toBe(1);
      expect(queryPromptIndex(store.raw!).items[0]?.tags).toEqual(["商品商业"]);
      expect(normalizeStoredPromptIndexTaxonomy(store.raw!)).toBe(0);
    } finally {
      store.close();
    }
  });

  test("keeps source filtering independent from display categories", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-index-source-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      replacePromptIndex(
        store.raw!,
        "source-a",
        normalizePromptSourceIndexItems(
          { id: "source-a", name: "同名来源", githubUrl: "https://example.com/a" },
          [{ id: "a-1", title: "来源 A", prompt: "提示词 A" }],
        ),
      );
      replacePromptIndex(
        store.raw!,
        "source-b",
        normalizePromptSourceIndexItems(
          { id: "source-b", name: "同名来源", githubUrl: "https://example.com/b" },
          [{ id: "b-1", title: "来源 B", prompt: "提示词 B" }],
        ),
      );

      expect(queryPromptIndex(store.raw!, { sourceId: "source-a" }).items.map((item) => item.id)).toEqual(["a-1"]);
      expect(queryPromptIndex(store.raw!, { sourceId: "source-b" }).items.map((item) => item.id)).toEqual(["b-1"]);
      expect(queryPromptIndex(store.raw!, { category: "同名来源" }).total).toBe(2);
    } finally {
      store.close();
    }
  });
});

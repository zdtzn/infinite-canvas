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
  queryPromptCovers,
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
  test("sorts the full filtered result before pagination in both directions", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-order-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      replacePromptIndex(store.raw!, "ordered", normalizePromptIndexItems("ordered",
        Array.from({ length: 45 }, (_, index) => ({
          id: `example-${index}`, title: `Example ${index}`, prompt: "landscape illustration",
          category: index % 2 === 0 ? "selected" : "other",
        })),
      ));
      const expected = Array.from({ length: 23 }, (_, index) => `example-${index * 2}`);
      for (const order of ["asc", "desc"] as const) {
        const ids: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const result = queryPromptIndex(store.raw!, {
            sourceId: "ordered", category: "selected", keyword: "Example",
            order, page, pageSize: 10,
          });
          expect(result.total).toBe(23);
          ids.push(...result.items.map((item) => item.id));
        }
        expect(ids).toEqual(order === "asc" ? expected : [...expected].reverse());
      }
      expect(queryPromptIndex(store.raw!, { sourceId: "ordered", pageSize: 1 }).items[0].id).toBe("example-44");
    } finally {
      store.close();
    }
  });

  test("cover projection retains every item and source order without prompt bodies", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-covers-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      for (const id of ["one", "two"]) {
        replacePromptIndex(store.raw!, id, normalizePromptIndexItems(id, Array.from({ length: 125 }, (_, index) => ({ id: `${id}-${index}`, title: `Title ${index}`, prompt: "large body".repeat(100), coverUrl: `https://example.com/${index}.png` }))));
      }
      replacePromptIndex(store.raw!, "empty", []);
      const result = queryPromptCovers(store.raw!, ["two", "missing", "one", "empty"]);
      expect(result.items).toHaveLength(250);
      expect(result.items[0].id).toBe("two-0");
      expect(result.items[249].id).toBe("one-124");
      expect(result.indexedSourceIds).toEqual(["two", "one", "empty"]);
      expect(result.items[0]).not.toHaveProperty("prompt");
      expect(result.items[0]).not.toHaveProperty("preview");
    } finally {
      store.close();
    }
  });
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

  test("reclassifies stored themes and retains the previous theme when evidence is missing", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-taxonomy-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const insert = store.raw!.query("INSERT INTO prompt_index(source_id, prompt_id, title, prompt, cover_url, preview, tags_json, category, github_url, created_at, updated_at, indexed_at) VALUES ('legacy', ?, ?, ?, '', '', ?, '旧来源', '', '', '', 1)");
      insert.run("one", "国风茶具电商主图", "commercial product photography with ink wash details", JSON.stringify(["gpt-image-2", "作者", "电商设计"]));
      insert.run("two", "提取主体并放置透明背景", "将图中的主体单独保存", JSON.stringify(["创意灵感"]));
      insert.run("three", "旧索引记录", "旧文本", JSON.stringify(["建筑空间"]));

      expect(normalizeStoredPromptIndexTaxonomy(store.raw!)).toBe(2);
      expect(queryPromptIndex(store.raw!, { order: "asc" }).items.map((item) => item.tags)).toEqual([["商品商业"], ["图像编辑"], ["建筑空间"]]);
      expect(queryPromptIndex(store.raw!, { tags: ["图像编辑"] }).items.map((item) => item.id)).toEqual(["two"]);
      expect(queryPromptIndex(store.raw!, { media: "video" }).items.map((item) => item.id)).not.toContain("two");
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
      expect(queryPromptIndex(store.raw!, { sourceId: "source-a" }).items[0]?.sourceId).toBe("source-a");
      expect(queryPromptIndex(store.raw!, { sourceId: "source-b" }).items.map((item) => item.id)).toEqual(["b-1"]);
      expect(queryPromptIndex(store.raw!, { category: "同名来源" }).total).toBe(2);
    } finally {
      store.close();
    }
  });

  test("searches all terms literally and ranks title matches before paginating", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-search-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      replacePromptIndex(store.raw!, "source", normalizePromptIndexItems("source", [
        { id: "exact", title: "商品 主图", prompt: "绿底设计" },
        { id: "prefix", title: "商品 主图 模板", prompt: "Étoile 版式" },
        { id: "reordered", title: "主图中的商品", prompt: "白底素材" },
        { id: "body", title: "目录样例", prompt: "商品摄影，输出电商主图，亮度 50%" },
        { id: "secondary", title: "画面资产", prompt: "仅提到商品", tags: ["主图", "needs_ref"] },
      ]));
      const index = store.raw!;
      const find = (keyword: string, options: Parameters<typeof queryPromptIndex>[1] = {}) => queryPromptIndex(index, { keyword, ...options }).items.map(({ id }) => id);
      expect(find(" 商品　主图 ")).toEqual(["exact", "prefix", "reordered", "secondary", "body"]);
      expect(find("商品 主图", { page: 2, pageSize: 2 })).toEqual(["reordered", "secondary"]);
      expect(find("商品 主图", { order: "asc" })).toEqual(["exact", "prefix", "reordered", "body", "secondary"]);
      expect(find("商品 主图", { order: "desc", pageSize: 1 })).toEqual(["secondary"]);
      expect(find("% _")).toEqual([]);
      expect(find("% 亮度")).toEqual(["body"]);
      expect(find("étoile")).toEqual(["prefix"]);
      expect(find("商品 needs_ref")).toEqual(["secondary"]);
    } finally {
      store.close();
    }
  });

  test("merges exact cross-source matches before paging with one link per source", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-duplicates-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const index = store.raw!;
      const shared = "同一段完整正文";
      replacePromptIndex(index, "a", normalizePromptSourceIndexItems({ id: "a", name: "来源 A", githubUrl: "https://example.com/a" }, [
        { id: "a1", title: "原题", prompt: shared, tags: ["图片模板"] },
        { id: "a2", title: "同源版本", prompt: shared },
        { id: "a3", title: "同名版本", prompt: shared + "。" },
      ]));
      replacePromptIndex(index, "b", normalizePromptSourceIndexItems({ id: "b", name: "来源 B", githubUrl: "https://example.com/b" }, [
        { id: "b1", title: "外部版本", prompt: shared, tags: ["视频模板", "需要参考图"] },
        { id: "b2", title: "同名版本", prompt: "另一段正文" },
      ]));

      const first = queryPromptIndex(index, { order: "asc", pageSize: 1 });
      expect(first.total).toBe(3);
      expect(first.items[0]).toMatchObject({
        id: "a1", prompt: shared, usage: { media: "general", requiresReference: true },
        sources: [{ sourceId: "a", githubUrl: "https://example.com/a" }, { sourceId: "b", githubUrl: "https://example.com/b" }],
      });
      expect(queryPromptIndex(index, { category: "来源 A", order: "asc" }).items.map(({ id }) => id)).toEqual(["a1", "a2", "a3"]);
      expect(queryPromptIndex(index, { keyword: "同名版本", order: "asc" }).items.map(({ id }) => id)).toEqual(["a3", "b2"]);
      expect(queryPromptIndex(index, { keyword: "外部版本" }).items.map(({ id }) => id)).toEqual(["b1"]);
      expect(queryPromptIndex(index, { order: "asc", page: 4, pageSize: 1 })).toMatchObject({ total: 3, items: [] });
      expect(queryPromptIndex(index, { enabledSourceIds: ["a"], order: "asc" })).toMatchObject({ categories: ["来源 A"], total: 3 });
      expect(queryPromptIndex(index, { enabledSourceIds: [], sourceId: "a" })).toMatchObject({ categories: [], items: [], tags: [], total: 0, indexed: true });
      expect(queryPromptIndex(index, { media: "image", order: "asc" }).items.map(({ id }) => id)).toEqual(["a1", "a2", "a3", "b2"]);
      expect(queryPromptIndex(index, { media: "video", order: "asc" }).items[0]).toMatchObject({ id: "a2", usage: { media: "video", requiresReference: true } });
    } finally {
      store.close();
    }
  });

  test("retains scoped origins when a keyword or theme only matches one copy", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-origin-scope-"));
    directories.push(dataDir);
    const store = openAppDatabase({ dataDir });
    try {
      const index = store.raw!;
      const prompt = "同一段完整正文";
      for (const source of [
        { id: "a", name: "来源 A", title: "杯子商品主图", tags: ["电商设计"] },
        { id: "b", name: "来源 B", title: "不同标题", tags: ["需要参考图"] },
        { id: "c", name: "来源 C", title: "未启用的视频模板", tags: ["视频模板"] },
      ]) {
        replacePromptIndex(index, source.id, normalizePromptSourceIndexItems({ ...source, githubUrl: `https://example.com/${source.id}` }, [
          { id: source.id, title: source.title, prompt, tags: source.tags },
        ]));
      }
      const enabledSourceIds = ["a", "b"];
      const keyword = "杯子商品主图";
      const expected = {
        total: 1,
        items: [{ id: "a", usage: { media: "general", requiresReference: true },
          sources: [{ sourceId: "a", githubUrl: "https://example.com/a" }, { sourceId: "b", githubUrl: "https://example.com/b" }],
        }],
      };
      expect(queryPromptIndex(index, { enabledSourceIds, keyword })).toMatchObject(expected);
      expect(queryPromptIndex(index, { enabledSourceIds, tags: ["商品商业"] })).toMatchObject(expected);
      expect(queryPromptIndex(index, { enabledSourceIds, keyword, sourceId: "a" }).items[0]?.sources).toBeUndefined();
      expect(queryPromptIndex(index, { enabledSourceIds, keyword, category: "来源 A" }).items[0]?.sources).toBeUndefined();
      expect(queryPromptIndex(index, { keyword, media: "image" })).toMatchObject(expected);
    } finally {
      store.close();
    }
  });

  test("backfills usable metadata and case-folded search on an existing index", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-prompt-usage-migration-"));
    directories.push(dataDir);
    const legacy = openAppDatabase({ dataDir });
    try {
      const index = legacy.raw!;
      index.exec(`
        ALTER TABLE prompt_index DROP COLUMN source_tags_json;
        ALTER TABLE prompt_index DROP COLUMN media;
        ALTER TABLE prompt_index DROP COLUMN requires_reference;
        ALTER TABLE prompt_index DROP COLUMN search_title;
        ALTER TABLE prompt_index DROP COLUMN search_text;
        DELETE FROM schema_migrations WHERE version = 30;
      `);
      index.query("INSERT INTO prompt_index(source_id, prompt_id, title, prompt, tags_json, indexed_at) VALUES (?, ?, ?, ?, ?, 1)")
        .run("old", "legacy", "Élan", "Use the uploaded image to create a short video.", JSON.stringify(["视频模板", "需要参考图"]));
    } finally {
      legacy.close();
    }
    const current = openAppDatabase({ dataDir });
    try {
      const index = current.raw!;
      expect(queryPromptIndex(index, { media: "video", keyword: "élan" }).items[0]).toMatchObject({
        id: "legacy", sourceTags: ["视频模板", "需要参考图"], usage: { media: "video", requiresReference: true },
      });
      expect(queryPromptIndex(index, { media: "image", keyword: "élan" }).items).toEqual([]);
    } finally {
      current.close();
    }
  });

  test("rejects incomplete authoritative source snapshots", () => {
    const source = { id: "source", name: "来源", githubUrl: "https://example.com" };
    expect(() => normalizePromptSourceIndexItems(source, [])).toThrow("没有返回提示词");
    expect(() => normalizePromptSourceIndexItems(source, [{ title: "有效项", prompt: "有效正文" }, { title: "缺正文" }])).toThrow("缺少标题、正文");
    expect(() => normalizePromptSourceIndexItems(source, Array(20_001).fill({ title: "过大", prompt: "正文" }))).toThrow("超过索引上限");
  });
});

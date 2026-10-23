import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import { AnnouncementError, createAnnouncementService } from "./service";
import { DEFAULT_ANNOUNCEMENT_STYLE } from "../../../shared/announcement-style";

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

describe("announcement service", () => {
  test("styles persist across restart and style-only edits preserve read receipts and publication time", () => {
    const { dataDir, store, service, setNow } = setup();
    let id: string;
    const style = { title: { font: "sans", color: "#365E50", size: 36 }, body: { letterSpacing: 0.12, lineHeight: 2.2, weight: 400 } };
    try {
      const created = service.create("admin", { title: "样式公告", content: "公告完整正文", type: "notice", status: "published", style });
      id = created.id;
      expect(created.style.title.color).toBe("#365e50");
      service.markRead("alice", id);
      setNow(200);
      const updated = service.update("admin", id, { style: { ...created.style, title: { ...created.style.title, size: 40 } } });
      expect(updated.publishedAt).toBe(100);
      expect(updated.updatedAt).toBe(200);
      expect(service.listPublished("alice", { unreadOnly: true }).items).toEqual([]);
      expect(service.listPublished("bob").items[0].style.title.size).toBe(40);
      expect(service.update("admin", id, { pinned: true }).style).toEqual(updated.style);
      const audit = store.raw!.query("SELECT after_json FROM admin_audit_logs WHERE action = 'announcement.update' LIMIT 1").get() as { after_json: string };
      expect(JSON.parse(audit.after_json).style.title.size).toBe(40);
    } finally { store.close(); }
    const reopened = openAppDatabase({ dataDir });
    try {
      const resumed = createAnnouncementService(reopened.raw!, { now: () => 500 });
      const item = resumed.listPublished("alice").items[0];
      expect(item.isRead).toBe(true);
      expect(item.style.title).toMatchObject({ font: "sans", size: 40, color: "#365e50" });
      expect(item.style.body).toMatchObject({ letterSpacing: 0.12, lineHeight: 2.2, weight: 400 });
      expect(resumed.update("admin", id!, { style: null }).style).toEqual(DEFAULT_ANNOUNCEMENT_STYLE);
      expect(resumed.listPublished("alice").unreadCount).toBe(0);
      resumed.update("admin", id!, { content: "修改后的公告正文" });
      expect(resumed.listPublished("alice").unreadCount).toBe(1);
    } finally { reopened.close(); }
  });

  test("rejects unsafe or invalid typography without writing and defaults missing fields", () => {
    const { store, service } = setup();
    try {
      const item = service.create("admin", { title: "默认公告", content: "公告正文", type: "notice", status: "draft" });
      expect(item.style).toEqual(DEFAULT_ANNOUNCEMENT_STYLE);
      for (const style of ["bad", [], { title: null }, { body: [] }, { title: { font: "__proto__" } }, { title: { color: "url(https://bad.test)" } }, { title: { size: 49 } }, { body: { size: 10 } }, { body: { size: "18" } }, { body: { lineHeight: Infinity } }, { body: { letterSpacing: -0.01 } }, { body: { weight: 900 } }]) {
        expect(() => service.update("admin", item.id, { style })).toThrow(AnnouncementError);
      }
      expect(service.listAdmin().items[0].style).toEqual(item.style);
      expect(store.raw!.query("SELECT count(*) AS count FROM admin_audit_logs").get()).toEqual({ count: 1 });
    } finally { store.close(); }
  });

  test("upgrades existing announcements without changing their content or read receipts", () => {
    const { dataDir, store, service } = setup();
    const item = service.create("admin", { title: "旧版公告", content: "保留原有正文", type: "notice", status: "published" });
    service.markRead("alice", item.id);
    store.raw!.exec("DELETE FROM schema_migrations WHERE version = 27; ALTER TABLE system_announcements DROP COLUMN style_json;");
    store.close();
    const reopened = openAppDatabase({ dataDir });
    try {
      const migrated = createAnnouncementService(reopened.raw!).listPublished("alice").items[0];
      expect(migrated.id).toBe(item.id);
      expect(migrated.content).toBe(item.content);
      expect(migrated.publishedAt).toBe(item.publishedAt);
      expect(migrated.isRead).toBe(true);
      expect(migrated.style).toEqual(DEFAULT_ANNOUNCEMENT_STYLE);
    } finally { reopened.close(); }
  });

  test("newest sorting lets a fresh normal announcement precede an older pinned one without changing the center's default order", () => {
    const { store, service, setNow } = setup();
    try {
      const pinned = service.create("admin", { title: "旧置顶公告", content: "需要保留的旧通知", type: "notice", status: "published", pinned: true });
      setNow(200);
      const latest = service.create("admin", { title: "最新普通公告", content: "应首先自动提醒的新通知", type: "update", status: "published", pinned: false });
      expect(service.listPublished("alice", { pageSize: 1 }).items.map(item => item.id)).toEqual([pinned.id]);
      const newest = service.listPublished("alice", { pageSize: 1, unreadOnly: true, sort: "newest" });
      expect(newest.items.map(item => item.id)).toEqual([latest.id]);
      expect(newest.total).toBe(2);
      expect(newest.unreadCount).toBe(2);
    } finally {
      store.close();
    }
  });

  test("read receipts survive reopening while a subsequently published announcement is unread", () => {
    const { dataDir, store, service } = setup();
    let readId: string;
    try {
      readId = service.create("admin", { title: "已经阅读公告", content: "这条公告阅读后不再提醒", type: "notice", status: "published", pinned: false }).id;
      service.markRead("alice", readId);
    } finally {
      store.close();
    }
    const reopened = openAppDatabase({ dataDir });
    try {
      const resumed = createAnnouncementService(reopened.raw!, { now: () => 500 });
      expect(resumed.listPublished("alice", { unreadOnly: true }).items).toEqual([]);
      expect(resumed.listPublished("bob", { unreadOnly: true }).items.map(item => item.id)).toEqual([readId!]);
      const fresh = resumed.create("admin", { title: "重开后新公告", content: "新发布的公告应重新提醒", type: "update", status: "published", pinned: false });
      expect(resumed.listPublished("alice", { unreadOnly: true }).items.map(item => item.id)).toEqual([fresh.id]);
      expect(resumed.listPublished("alice").items.find(item => item.id === readId)?.isRead).toBe(true);
    } finally {
      reopened.close();
    }
  });

  test("publishes, pins and isolates read state by user", () => {
    const { store, service, setNow } = setup();
    try {
      const draft = service.create("admin", {
        title: "待完善公告",
        summary: "草稿不会对普通用户展示",
        content: "这是一条尚未发布的草稿。",
        type: "notice",
        status: "draft",
        pinned: false,
      });
      setNow(200);
      const normal = service.create("admin", {
        title: "版本更新",
        summary: "新增了公告中心",
        content: "第一段。\n\n第二段。",
        type: "update",
        status: "published",
        pinned: false,
      });
      setNow(300);
      const pinned = service.create("admin", {
        title: "维护提醒",
        summary: "今晚短时维护",
        content: "维护期间已提交的任务不会丢失。",
        type: "maintenance",
        status: "published",
        pinned: true,
      });

      const alice = service.listPublished("alice", { page: 1, pageSize: 20 });
      expect(alice.items.map((item) => item.id)).toEqual([
        pinned.id,
        normal.id,
      ]);
      expect(alice.items.every((item) => item.isRead === false)).toBe(true);
      expect(alice.unreadCount).toBe(2);
      expect(alice.items.some((item) => item.id === draft.id)).toBe(false);

      setNow(400);
      service.markRead("alice", normal.id);
      expect(service.listPublished("alice").unreadCount).toBe(1);
      expect(service.listPublished("bob").unreadCount).toBe(2);
      expect(
        service
          .listPublished("alice", { unreadOnly: true })
          .items.map((item) => item.id),
      ).toEqual([pinned.id]);

      service.markAllRead("alice");
      expect(service.listPublished("alice").unreadCount).toBe(0);
      expect(service.listReadReceipts("alice")).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("republishing changed content resets reads and archive hides it", () => {
    const { store, service, setNow } = setup();
    try {
      const announcement = service.create("admin", {
        title: "能力更新",
        summary: "第一版摘要",
        content: "第一版正文",
        type: "update",
        status: "published",
        pinned: false,
      });
      service.markAllRead("alice");
      expect(service.listPublished("alice").unreadCount).toBe(0);

      setNow(500);
      const updated = service.update("admin", announcement.id, {
        content: "第二版正文",
      });
      expect(updated.publishedAt).toBe(500);
      expect(service.listPublished("alice").unreadCount).toBe(1);

      setNow(600);
      service.update("admin", announcement.id, { status: "archived" });
      expect(service.listPublished("alice").items).toEqual([]);
      expect(service.listAdmin({ status: "archived" }).items[0]?.id).toBe(
        announcement.id,
      );

      const actions = store
        .raw!.query(
          "SELECT action FROM admin_audit_logs WHERE action LIKE 'announcement.%' ORDER BY created_at",
        )
        .all() as Array<{ action: string }>;
      expect(actions.map((item) => item.action)).toEqual([
        "announcement.create",
        "announcement.update",
        "announcement.archive",
      ]);
    } finally {
      store.close();
    }
  });

  test("validates fields and supports admin filters", () => {
    const { store, service } = setup();
    try {
      expect(() =>
        service.create("admin", {
          title: "短",
          content: "有效正文",
          type: "notice",
          status: "draft",
        }),
      ).toThrow(AnnouncementError);
      expect(() =>
        service.create("admin", {
          title: "置顶字段错误",
          content: "有效正文",
          type: "notice",
          status: "draft",
          pinned: "false",
        }),
      ).toThrow("置顶状态无效");

      service.create("admin", {
        title: "渠道维护通知",
        summary: "SADAI 渠道维护",
        content: "维护完成后会恢复生成。",
        type: "maintenance",
        status: "draft",
      });
      expect(
        service.listAdmin({
          search: "SADAI",
          type: "maintenance",
          status: "draft",
        }).total,
      ).toBe(1);
      expect(() => service.listAdmin({ status: "unknown" })).toThrow(
        "公告状态无效",
      );
    } finally {
      store.close();
    }
  });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-announcements-"));
  directories.push(dataDir);
  const store = openAppDatabase({ dataDir });
  store
    .raw!.query(
      `INSERT INTO users(user_id, display_name, is_admin, status, created_at)
       VALUES ('admin', '掌教', 1, 'NORMAL', 1),
              ('alice', 'Alice', 0, 'NORMAL', 2),
              ('bob', 'Bob', 0, 'NORMAL', 3)`,
    )
    .run();
  let timestamp = 100;
  return {
    dataDir,
    store,
    service: createAnnouncementService(store.raw!, { now: () => timestamp }),
    setNow: (value: number) => {
      timestamp = value;
    },
  };
}

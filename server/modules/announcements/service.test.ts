import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import { AnnouncementError, createAnnouncementService } from "./service";

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
    store,
    service: createAnnouncementService(store.raw!, { now: () => timestamp }),
    setNow: (value: number) => {
      timestamp = value;
    },
  };
}

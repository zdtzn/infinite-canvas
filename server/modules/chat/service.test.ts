import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import { createChatService } from "./service";

const directories: string[] = [];

afterEach(() => {
  while (directories.length)
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
});

describe("chat service", () => {
  test("persists conversations and keeps them isolated by user", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a", { title: "问图", presetId: "catgirl" });
      expect(conversation.presetId).toBe("catgirl");
      const turn = service.beginTurn("user-a", conversation.id, {
        content: "这张图适合做什么？",
        attachments: [{ assetKey: "image:one", mimeType: "image/png", name: "one.png" }],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", turn.assistantMessage.id, "适合做商品主图参考。");

      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(2);
      expect(service.getConversationWithMessages("user-b", conversation.id)).toBeNull();
      expect(service.contextMessages("user-a", conversation.id).map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(service.assetReferenceRoots("user-a")).toEqual([{ attachments: [{ storageKey: "image:one" }] }]);
      expect(service.assetReferenceRoots("user-b")).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("binds a preset to the conversation and persists explicit switches", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a", { presetId: "catgirl" });
      expect(service.getConversation("user-a", conversation.id)?.presetId).toBe("catgirl");

      const switched = service.updateConversationPreset("user-a", conversation.id, "moxuan");
      expect(switched.presetId).toBe("moxuan");
      expect(service.getConversationWithMessages("user-a", conversation.id)?.conversation.presetId).toBe("moxuan");
    } finally {
      store.close();
    }
  });

  test("imports a conversation into a new preset-bound record without trusting runtime settings", () => {
    const { store, service } = setup();
    try {
      store.raw!
        .query("INSERT INTO assets(asset_key, user_id, mime_type, bytes, created_at) VALUES (?, ?, 'image/png', 100, ?)")
        .run("image:available", "user-a", Date.now());
      const imported = service.importConversation("user-a", {
        format: "infinite-canvas.chat",
        version: 1,
        conversation: {
          title: "外部会话",
          presetId: "catgirl",
          channelId: "untrusted-channel",
          model: "untrusted-model",
        },
        messages: [
          {
            role: "user",
            content: "带图的问题",
            attachments: [
              { assetKey: "image:available", mimeType: "image/png", name: "available.png" },
              { assetKey: "image:missing", mimeType: "image/png", name: "missing.png" },
            ],
            status: "completed",
          },
          { role: "assistant", content: "已恢复", attachments: [], status: "completed" },
        ],
      });

      expect(imported.conversation.presetId).toBe("catgirl");
      expect(imported.conversation.channelId).toBe("");
      expect(imported.conversation.model).toBe("");
      expect(imported.skippedAttachmentCount).toBe(1);
      expect(imported.messages).toHaveLength(2);
      expect(imported.messages[0].attachments).toEqual([{ assetKey: "image:available", mimeType: "image/png", name: "available.png" }]);
      expect(service.getConversationWithMessages("user-a", imported.conversation.id)?.conversation.title).toBe("外部会话");
    } finally {
      store.close();
    }
  });

  test("marks interrupted streaming messages as failed when the service starts", () => {
    const { store, service } = setup();
    const conversation = service.createConversation("user-a");
    const turn = service.beginTurn("user-a", conversation.id, {
      content: "继续",
      attachments: [],
      channelId: "text-channel",
      model: "gpt-4o-mini",
    });

    const restarted = createChatService(store.raw!);
    const message = restarted.getConversationWithMessages("user-a", conversation.id)?.messages.find((item) => item.id === turn.assistantMessage.id);
    expect(message?.status).toBe("failed");
    expect(message?.error).toBeTruthy();
    store.close();
  });

  test("keeps image-only turns and their attachments in context", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const turn = service.beginTurn("user-a", conversation.id, {
        content: "",
        attachments: [{ assetKey: "image:only", mimeType: "image/png", name: "only.png" }],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", turn.assistantMessage.id, "我看到了这张图。");

      const context = service.contextMessages("user-a", conversation.id);
      expect(context).toHaveLength(2);
      expect(context[0]).toMatchObject({ content: "", attachments: [{ assetKey: "image:only" }] });
      expect(service.getChatUsage("user-a")).toMatchObject({ usedToday: 1, inputCharacters: 0, outputCharacters: 8 });
    } finally {
      store.close();
    }
  });

  test("applies the context character budget by dropping older turns", () => {
    const { store, service } = setup({ now: () => 1_000 });
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "第一轮问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "第一轮回答");
      const second = service.beginTurn("user-a", conversation.id, {
        content: "第二轮问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", second.assistantMessage.id, "第二轮回答");

      const context = service.contextMessages("user-a", conversation.id, 24, 12);
      expect(context.map((message) => message.content)).toEqual(["第二轮问题", "第二轮回答"]);
    } finally {
      store.close();
    }
  });

  test("enforces a daily question limit and reports usage", () => {
    const { store, service } = setup({ dailyLimit: 1 });
    try {
      const conversation = service.createConversation("user-a");
      service.beginTurn("user-a", conversation.id, {
        content: "第一次",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });

      expect(() =>
        service.beginTurn("user-a", conversation.id, {
          content: "第二次",
          attachments: [],
          channelId: "text-channel",
          model: "gpt-4o-mini",
        }),
      ).toThrow(/今日问道次数已用尽/);
      expect(service.getChatUsage("user-a")).toMatchObject({ dailyLimit: 1, usedToday: 1, remainingToday: 0 });
    } finally {
      store.close();
    }
  });

  test("retries a failed answer without inserting a duplicate user message", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "请继续分析这张图",
        attachments: [{ assetKey: "image:retry", mimeType: "image/jpeg", name: "retry.jpg" }],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.failAssistant("user-a", first.assistantMessage.id, "已经收到一部分", "上游中断");

      const retried = service.beginTurn("user-a", conversation.id, {
        content: "这段内容不应覆盖原问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
        retryAssistantMessageId: first.assistantMessage.id,
      });
      expect(retried.userMessage.id).toBe(first.userMessage.id);
      expect(retried.userMessage.content).toBe("请继续分析这张图");
      expect(retried.userMessage.attachments).toEqual([{ assetKey: "image:retry", mimeType: "image/jpeg", name: "retry.jpg" }]);
      expect(retried.assistantMessage.id).toBe(first.assistantMessage.id);
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(2);
      expect(service.getChatUsage("user-a").usedToday).toBe(2);

      expect(() =>
        service.beginTurn("user-a", conversation.id, {
          content: "不能并发重试已在进行中的回答",
          attachments: [],
          channelId: "text-channel",
          model: "gpt-4o-mini",
          retryAssistantMessageId: first.assistantMessage.id,
        }),
      ).toThrow(/已经不能重试/);
      expect(service.getChatUsage("user-a").usedToday).toBe(2);
    } finally {
      store.close();
    }
  });

  test("regenerates the latest completed answer without duplicating the question", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "请给我一个方案",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "旧回答");

      const regenerated = service.beginTurn("user-a", conversation.id, {
        content: "这段内容不应覆盖原问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
        retryAssistantMessageId: first.assistantMessage.id,
      });
      expect(regenerated.userMessage.id).toBe(first.userMessage.id);
      expect(regenerated.assistantMessage.id).toBe(first.assistantMessage.id);
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(2);
      expect(service.getChatUsage("user-a").usedToday).toBe(2);
    } finally {
      store.close();
    }
  });

  test("edits a question by truncating later context before creating a new answer", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "第一版问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "第一版回答");
      const later = service.beginTurn("user-a", conversation.id, {
        content: "后续问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", later.assistantMessage.id, "后续回答");

      const edited = service.beginTurn("user-a", conversation.id, {
        content: "修正后的问题",
        attachments: [{ assetKey: "image:edited", mimeType: "image/png", name: "edited.png" }],
        channelId: "text-channel",
        model: "gpt-4o-mini",
        editUserMessageId: first.userMessage.id,
      });
      const detail = service.getConversationWithMessages("user-a", conversation.id)!;
      expect(edited.userMessage.id).toBe(first.userMessage.id);
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0]).toMatchObject({ content: "修正后的问题", attachments: [{ assetKey: "image:edited" }] });
      expect(detail.messages[1].status).toBe("streaming");
    } finally {
      store.close();
    }
  });

  test("deletes a message and everything after it as one context rollback", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "保留的问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "保留的回答");
      const second = service.beginTurn("user-a", conversation.id, {
        content: "需要删除的问题",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", second.assistantMessage.id, "需要删除的回答");

      const detail = service.deleteMessagesFrom("user-a", conversation.id, second.userMessage.id);
      expect(detail.messages.map((message) => message.content)).toEqual(["保留的问题", "保留的回答"]);
    } finally {
      store.close();
    }
  });

  test("continues the latest answer while preserving its existing content", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "请分两段回答",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "第一段");

      const continued = service.beginContinuation("user-a", conversation.id, first.assistantMessage.id, "text-channel", "gpt-4o-mini");
      expect(continued.userMessage.id).toBe(first.userMessage.id);
      expect(continued.assistantMessage.content).toBe("第一段");
      expect(continued.contextMessages.map((message) => message.content)).toEqual(["请分两段回答", "第一段"]);
      const completed = service.completeAssistant("user-a", first.assistantMessage.id, "第一段第二段", 3);
      expect(completed.content).toBe("第一段第二段");
      expect(service.getChatUsage("user-a")).toMatchObject({ usedToday: 2, outputCharacters: 6 });
    } finally {
      store.close();
    }
  });
});

function setup(options: { dailyLimit?: number | null; now?: () => number } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-chat-"));
  directories.push(dataDir);
  const store = openAppDatabase({ dataDir });
  const state = store.loadState();
  state.users = {
    "user-a": { userId: "user-a", displayName: "User A", createdAt: 1 },
    "user-b": { userId: "user-b", displayName: "User B", createdAt: 1 },
  };
  store.saveState(state);
  return { store, service: createChatService(store.raw!, options) };
}

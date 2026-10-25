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
  test("loads the latest messages and pages through more than 1000 tied timestamps without gaps", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const insert = store.raw!.query(
        "INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, attachments_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'completed', '', 1, 1)",
      );
      const ids = Array.from({ length: 1206 }, (_, index) => `history-message-${index}`);
      store.raw!.transaction(() => {
        for (const [index, id] of ids.entries()) insert.run("user-a", id, conversation.id, index % 2 ? "assistant" : "user", `消息 ${index}`);
      })();

      let page = service.getConversationPage("user-a", conversation.id)!;
      expect(page.messages.map((message) => message.id)).toEqual(ids.slice(-100));
      expect(page.hasMore).toBe(true);
      const originalBefore = page.nextBefore!;
      insert.run("user-a", "history-new-message", conversation.id, "user", "翻页期间新增");
      expect(service.getConversationPage("user-a", conversation.id, { before: originalBefore })?.messages.map((message) => message.id)).toEqual(ids.slice(-200, -100));

      const loaded = [...page.messages];
      while (page.hasMore) {
        page = service.getConversationPage("user-a", conversation.id, { before: page.nextBefore! })!;
        loaded.unshift(...page.messages);
      }
      expect(loaded.map((message) => message.id)).toEqual(ids);
      expect(page.nextBefore).toBeNull();
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(1207);
      expect(service.exportConversations("user-a")[0].messages).toHaveLength(1207);
      expect(service.getConversationPage("user-b", conversation.id, { before: originalBefore })).toBeNull();
      expect(service.exportConversations("user-b")).toEqual([]);
      expect(service.contextMessages("user-a", conversation.id).at(-1)?.id).toBe("history-new-message");
      expect(service.getTurn("user-a", conversation.id, ids[1204])?.assistantMessage.id).toBe(ids[1205]);
      expect(() => service.getTurn("user-b", conversation.id, ids[1204])).toThrow("对话不存在");
      for (const before of ["invalid", "", "MA", "LTE", "MS4w"])
        expect(() => service.getConversationPage("user-a", conversation.id, { before })).toThrow("消息分页位置无效");
      for (const limit of [0, -1, 1.5, 201, Number.NaN])
        expect(() => service.getConversationPage("user-a", conversation.id, { limit })).toThrow("每页消息数量");
      expect(service.getConversationPage("user-a", conversation.id, { limit: 200 })?.messages).toHaveLength(200);
    } finally {
      store.close();
    }
  });

  test("account conversation export does not inherit the sidebar conversation cap", () => {
    const { store, service } = setup();
    try {
      const insert = store.raw!.query(
        "INSERT INTO chat_conversations(user_id, conversation_id, title, preset_id, created_at, updated_at) VALUES ('user-a', ?, '历史对话', 'default', 1, 1)",
      );
      store.raw!.transaction(() => {
        for (let index = 0; index < 103; index++) insert.run(`export-conversation-${index}`);
      })();
      expect(service.listConversations("user-a")).toHaveLength(100);
      expect(service.exportConversations("user-a")).toHaveLength(103);
      expect(service.exportConversations("user-b")).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("replays an accepted client message without reserving or creating a second turn", () => {
    const { store, service } = setup({ dailyLimit: 1 });
    try {
      const conversation = service.createConversation("user-a");
      const input = { content: "只发送一次", attachments: [], channelId: "text-channel", model: "gpt-4o-mini", clientMessageId: "retry-client-message-1" };
      const first = service.beginTurn("user-a", conversation.id, input);
      const replay = service.beginTurn("user-a", conversation.id, input);
      expect(first.isReplay).toBe(false);
      expect(replay.isReplay).toBe(true);
      expect(replay.assistantMessage.id).toBe(first.assistantMessage.id);
      expect(replay.assistantMessage.status).toBe("streaming");
      service.completeAssistant("user-a", first.assistantMessage.id, "一次回答");
      expect(service.beginTurn("user-a", conversation.id, input).assistantMessage.status).toBe("completed");
      expect(service.getTurn("user-a", conversation.id, input.clientMessageId)?.assistantMessage.content).toBe("一次回答");
      expect(service.getTurn("user-a", conversation.id, "not-accepted-yet")).toBeNull();
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(2);
      expect(service.getChatUsage("user-a").usedToday).toBe(1);
      expect(() => service.beginTurn("user-a", conversation.id, { ...input, content: "不同的问题" })).toThrow("标识已用于其他内容");
      expect(() => service.beginTurn("user-a", conversation.id, { ...input, attachments: [{ assetKey: "image:other", mimeType: "image/png", name: "other.png" }] })).toThrow("标识已用于其他内容");
      expect(() => service.beginTurn("user-a", conversation.id, { ...input, canvasContext: { projectId: "different-context" } })).toThrow("标识已用于其他内容");
      const other = service.createConversation("user-a");
      expect(() => service.beginTurn("user-a", other.id, input)).toThrow("标识已用于其他内容");
    } finally {
      store.close();
    }
  });

  test("persists the client-generated user message id for optimistic reconciliation", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const clientMessageId = "optimistic-user-client-request-1";
      const turn = service.beginTurn("user-a", conversation.id, {
        content: "你好",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
        clientMessageId,
      });

      expect(turn.userMessage.id).toBe(clientMessageId);
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages[0]?.id).toBe(clientMessageId);
    } finally {
      store.close();
    }
  });

  test("replays retry and edit operation ids before streaming eligibility checks", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const input = { content: "原问题", attachments: [], channelId: "text-channel", model: "gpt-4o-mini", clientMessageId: "original-request-id" };
      const original = service.beginTurn("user-a", conversation.id, input);
      service.completeAssistant("user-a", original.assistantMessage.id, "原回答");
      const retryInput = { ...input, content: "", clientMessageId: "retry-operation-id", retryAssistantMessageId: original.assistantMessage.id };
      const retry = service.beginTurn("user-a", conversation.id, retryInput);
      expect(retry.isReplay).toBe(false);
      expect(service.beginTurn("user-a", conversation.id, retryInput)).toMatchObject({ isReplay: true, assistantMessage: { id: retry.assistantMessage.id, status: "streaming" } });
      expect(service.getTurn("user-a", conversation.id, retryInput.clientMessageId)?.assistantMessage.id).toBe(retry.assistantMessage.id);
      expect(service.getChatUsage("user-a").usedToday).toBe(2);
      expect(() => service.beginTurn("user-a", conversation.id, { ...retryInput, content: "更改请求" })).toThrow("标识已用于其他内容");
      service.completeAssistant("user-a", retry.assistantMessage.id, "重试回答");
      const editInput = { ...input, content: "编辑后的问题", clientMessageId: "edit-operation-id", editUserMessageId: original.userMessage.id };
      const edited = service.beginTurn("user-a", conversation.id, editInput);
      const editReplay = service.beginTurn("user-a", conversation.id, editInput);
      expect(editReplay.isReplay).toBe(true);
      expect(editReplay.assistantMessage.id).toBe(edited.assistantMessage.id);
      expect(editReplay.userMessage.id).toBe(original.userMessage.id);
      expect(service.getTurn("user-a", conversation.id, editInput.clientMessageId)?.assistantMessage.id).toBe(edited.assistantMessage.id);
      expect(service.getChatUsage("user-a").usedToday).toBe(3);
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages).toHaveLength(2);
      expect(() => service.beginTurn("user-a", conversation.id, { ...editInput, editUserMessageId: "another-user-message" })).toThrow("标识已用于其他内容");
      service.completeAssistant("user-a", edited.assistantMessage.id, "编辑后的回答");
      expect(service.beginTurn("user-a", conversation.id, editInput)).toMatchObject({ isReplay: true, assistantMessage: { content: "编辑后的回答", status: "completed" } });
      expect(() => service.beginTurn("user-a", conversation.id, input)).toThrow("对应的消息已被删除");
      expect(service.getChatUsage("user-a").usedToday).toBe(3);
    } finally {
      store.close();
    }
  });

  test("continuation operation ids replay while streaming and after completion without charging twice", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const original = service.beginTurn("user-a", conversation.id, { content: "继续回答", attachments: [], channelId: "text-channel", model: "model-a" });
      service.completeAssistant("user-a", original.assistantMessage.id, "第一段");
      const continueTurn = () => service.beginContinuation("user-a", conversation.id, original.assistantMessage.id, "text-channel", "model-a", "continue-operation-id");
      expect(continueTurn().isReplay).toBe(false);
      expect(continueTurn()).toMatchObject({ isReplay: true, assistantMessage: { content: "第一段", status: "streaming" } });
      expect(service.getTurn("user-a", conversation.id, "continue-operation-id")?.assistantMessage.id).toBe(original.assistantMessage.id);
      expect(() => service.beginContinuation("user-a", conversation.id, "different-assistant-id", "text-channel", "model-a", "continue-operation-id")).toThrow("标识已用于其他内容");
      expect(() => service.beginTurn("user-a", conversation.id, { content: "不同操作", attachments: [], channelId: "text-channel", model: "model-a", clientMessageId: "continue-operation-id" })).toThrow("标识已用于其他内容");
      service.completeAssistant("user-a", original.assistantMessage.id, "第一段第二段");
      expect(continueTurn()).toMatchObject({ isReplay: true, assistantMessage: { content: "第一段第二段", status: "completed" } });
      expect(service.getChatUsage("user-a").usedToday).toBe(2);
    } finally {
      store.close();
    }
  });

  test("rolls back acceptance and edited history together when quota rejects the operation", () => {
    const { store } = setup();
    let dailyLimit = 1;
    const service = createChatService(store.raw!, { getDailyLimit: () => dailyLimit });
    try {
      const conversation = service.createConversation("user-a");
      const input = { content: "原问题", attachments: [], channelId: "text-channel", model: "model-a", clientMessageId: "quota-original-id" };
      const original = service.beginTurn("user-a", conversation.id, input);
      service.completeAssistant("user-a", original.assistantMessage.id, "原回答");
      const edit = { ...input, content: "修改问题", editUserMessageId: original.userMessage.id, clientMessageId: "quota-edit-operation" };
      expect(() => service.beginTurn("user-a", conversation.id, edit)).toThrow("今日问道次数已用尽");
      expect(service.getTurn("user-a", conversation.id, edit.clientMessageId)).toBeNull();
      expect(service.getConversationWithMessages("user-a", conversation.id)?.messages.map((message) => message.content)).toEqual(["原问题", "原回答"]);
      dailyLimit = 2;
      expect(service.beginTurn("user-a", conversation.id, edit).isReplay).toBe(false);
      expect(service.getChatUsage("user-a").usedToday).toBe(2);
    } finally {
      store.close();
    }
  });

  test("persists operation acceptance across a server restart", () => {
    const { store, service, dataDir } = setup();
    let reopened: ReturnType<typeof openAppDatabase> | undefined;
    try {
      const conversation = service.createConversation("user-a");
      const input = { content: "断线后保留", attachments: [], channelId: "text-channel", model: "model-a", clientMessageId: "durable-operation-id" };
      const accepted = service.beginTurn("user-a", conversation.id, input);
      store.close();
      reopened = openAppDatabase({ dataDir });
      const restarted = createChatService(reopened.raw!);
      expect(restarted.beginTurn("user-a", conversation.id, input)).toMatchObject({ isReplay: true, assistantMessage: { id: accepted.assistantMessage.id, status: "failed" } });
      expect(restarted.getTurn("user-a", conversation.id, input.clientMessageId)?.userMessage.id).toBe(input.clientMessageId);
      expect(restarted.getChatUsage("user-a").usedToday).toBe(1);
    } finally {
      if (reopened) reopened.close();
      else store.close();
    }
  });

  test("keeps acceptance evidence after truncation and cleans it up only with its owner scope", () => {
    const { store, service } = setup();
    try {
      const first = service.createConversation("user-a");
      const second = service.createConversation("user-b");
      const input = { content: "同名请求", attachments: [], channelId: "text-channel", model: "model-a", clientMessageId: "shared-request-id" };
      const turn = service.beginTurn("user-a", first.id, input);
      service.completeAssistant("user-a", turn.assistantMessage.id, "完成");
      const other = service.beginTurn("user-b", second.id, input);
      service.deleteMessagesFrom("user-a", first.id, turn.assistantMessage.id);
      expect(service.getTurn("user-a", first.id, input.clientMessageId)).toBeNull();
      expect(() => service.beginTurn("user-a", first.id, input)).toThrow("对应的消息已被删除");
      expect(service.getTurn("user-b", second.id, input.clientMessageId)?.assistantMessage.id).toBe(other.assistantMessage.id);
      expect(store.raw!.query("SELECT COUNT(*) AS count FROM chat_turn_requests").get()).toEqual({ count: 2 });
      service.deleteConversation("user-a", first.id);
      expect(store.raw!.query("SELECT user_id FROM chat_turn_requests").all()).toEqual([{ user_id: "user-b" }]);
      store.raw!.query("DELETE FROM users WHERE user_id = 'user-b'").run();
      expect(store.raw!.query("SELECT COUNT(*) AS count FROM chat_turn_requests").get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });

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

  test("persists editable long-term memories and captures explicit facts", () => {
    const { store, service } = setup();
    try {
      const manual = service.createMemory("user-a", { kind: "preference", content: "偏好简洁、可执行的方案", pinned: true });
      expect(service.listMemories("user-a")).toContainEqual(expect.objectContaining({ id: manual.id, pinned: true }));
      const updated = service.updateMemory("user-a", manual.id, { content: "偏好简洁、可执行并保留风险说明的方案" });
      expect(updated?.content).toContain("风险说明");

      const conversation = service.createConversation("user-a");
      const turn = service.beginTurn("user-a", conversation.id, {
        content: "请记住：我的项目是一个中文 AI 创作工具。",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", turn.assistantMessage.id, "后续会围绕创作工具继续。" );
      expect(service.memoryContext("user-a")).toContain("中文 AI 创作工具");

      expect(service.deleteMemory("user-a", manual.id)).toBe(true);
      expect(service.listMemories("user-a").some((item) => item.id === manual.id)).toBe(false);
    } finally {
      store.close();
    }
  });

  test("keeps a rolling conversation summary after older messages leave the context window", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const first = service.beginTurn("user-a", conversation.id, {
        content: "第一轮讨论项目定位",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", first.assistantMessage.id, "确定以 AI 创作工具为核心。");

      const second = service.beginTurn("user-a", conversation.id, {
        content: "第二轮确认上线观察指标",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.completeAssistant("user-a", second.assistantMessage.id, "重点观察任务成功率和延迟。");

      const context = service.memoryContext("user-a", conversation.id);
      expect(context).toContain("第一轮讨论项目定位");
      expect(context).toContain("第二轮确认上线观察指标");
      expect(context).toContain("任务成功率和延迟");
    } finally {
      store.close();
    }
  });

  test("persists partial assistant output without charging it as a completed answer", () => {
    const { store, service } = setup();
    try {
      const conversation = service.createConversation("user-a");
      const turn = service.beginTurn("user-a", conversation.id, {
        content: "后台继续回答",
        attachments: [],
        channelId: "text-channel",
        model: "gpt-4o-mini",
      });
      service.updateAssistantProgress("user-a", turn.assistantMessage.id, "已经生成一部分");

      const current = service.getConversationWithMessages("user-a", conversation.id)?.messages.find((item) => item.id === turn.assistantMessage.id);
      expect(current).toMatchObject({ status: "streaming", content: "已经生成一部分" });
      expect(service.getChatUsage("user-a")).toMatchObject({ usedToday: 1, outputCharacters: 0 });
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
  return { store, dataDir, service: createChatService(store.raw!, options) };
}

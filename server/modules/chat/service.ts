import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import { resolveChatPreset } from "../../lib/chat-presets";

const MAX_CONVERSATIONS_PER_USER = 100;
const MAX_TITLE_CHARACTERS = 80;
const MAX_MESSAGE_CHARACTERS = 20_000;
const MAX_ATTACHMENTS = 4;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ASSET_KEY_PATTERN = /^image:[A-Za-z0-9._:-]{1,180}$/;
const DEFAULT_CONTEXT_CHARACTER_BUDGET = 60_000;
const MAX_IMPORTED_MESSAGES = 200;
const MAX_IMPORTED_CHARACTERS = 300_000;
const MAX_MEMORIES_PER_USER = 80;
const MAX_MEMORY_CHARACTERS = 4_000;
const MEMORY_CONTEXT_CHARACTER_BUDGET = 8_000;

export type ChatAttachment = {
  assetKey: string;
  mimeType: string;
  name: string;
};

export type ChatMessageStatus = "streaming" | "completed" | "failed";

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  attachments: ChatAttachment[];
  status: ChatMessageStatus;
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatConversation = {
  id: string;
  title: string;
  presetId: string;
  channelId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatMemoryKind = "summary" | "fact" | "preference" | "goal";

export type ChatMemory = {
  id: string;
  kind: ChatMemoryKind;
  content: string;
  sourceConversationId: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "CHAT_INVALID",
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export function createChatService(
  database: Database,
  options: {
    now?: () => number;
    timeZone?: string;
    dailyLimit?: number | null;
    getDailyLimit?: (userId: string) => number | null;
  } = {},
) {
  const now = options.now || Date.now;
  const timeZone = options.timeZone || "Asia/Shanghai";
  const dailyLimit = options.dailyLimit == null
    ? null
    : Math.max(0, Math.floor(options.dailyLimit));
  const limitForUser = (userId: string) =>
    options.getDailyLimit ? normalizeDailyLimit(options.getDailyLimit(userId)) : dailyLimit;

  database
    .query(
      "UPDATE chat_messages SET status = 'failed', error = ?, updated_at = ? WHERE status = 'streaming'",
    )
    .run("服务重启，本次回答已中断", now());

  function listConversations(userId: string) {
    return (
      database
        .query(
          `SELECT c.*, (
             SELECT content FROM chat_messages m
             WHERE m.user_id = c.user_id AND m.conversation_id = c.conversation_id
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
           ) AS last_message
           FROM chat_conversations c
           WHERE c.user_id = ?
           ORDER BY c.updated_at DESC
           LIMIT ?`,
        )
        .all(userId, MAX_CONVERSATIONS_PER_USER) as Array<
        ChatConversationRow & { last_message: string | null }
      >
    ).map((row) => ({
      ...conversationFromRow(row),
      lastMessage: String(row.last_message || "").slice(0, 120),
    }));
  }

  function listMemories(userId: string) {
    return (database.query(
      "SELECT * FROM chat_memories WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?",
    ).all(userId, MAX_MEMORIES_PER_USER) as ChatMemoryRow[]).map(memoryFromRow);
  }

  function getMemory(userId: string, memoryId: string) {
    const row = database.query("SELECT * FROM chat_memories WHERE user_id = ? AND memory_id = ?").get(userId, validId(memoryId, "记忆 ID")) as ChatMemoryRow | null;
    return row ? memoryFromRow(row) : null;
  }

  function createMemory(userId: string, input: unknown) {
    const source = inputRecord(input);
    const kind = normalizeMemoryKind(source.kind);
    const content = requiredText(source.content, MAX_MEMORY_CHARACTERS, "记忆内容");
    const sourceConversationId = optionalText(source.sourceConversationId, 128);
    const timestamp = now();
    const memory: ChatMemory = {
      id: randomUUID(),
      kind,
      content,
      sourceConversationId,
      pinned: Boolean(source.pinned),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.query(
      "INSERT INTO chat_memories(user_id, memory_id, kind, content, source_conversation_id, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, memory.id, memory.kind, memory.content, memory.sourceConversationId, memory.pinned ? 1 : 0, timestamp, timestamp);
    pruneMemories(userId);
    return memory;
  }

  function updateMemory(userId: string, memoryId: string, input: unknown) {
    const existing = getMemory(userId, memoryId);
    if (!existing) return null;
    const source = inputRecord(input);
    const kind = source.kind === undefined ? existing.kind : normalizeMemoryKind(source.kind);
    const content = source.content === undefined ? existing.content : requiredText(source.content, MAX_MEMORY_CHARACTERS, "记忆内容");
    const pinned = source.pinned === undefined ? existing.pinned : Boolean(source.pinned);
    const timestamp = now();
    database.query(
      "UPDATE chat_memories SET kind = ?, content = ?, pinned = ?, updated_at = ? WHERE user_id = ? AND memory_id = ?",
    ).run(kind, content, pinned ? 1 : 0, timestamp, userId, validId(memoryId, "记忆 ID"));
    return getMemory(userId, memoryId);
  }

  function deleteMemory(userId: string, memoryId: string) {
    const result = database.query("DELETE FROM chat_memories WHERE user_id = ? AND memory_id = ?").run(userId, validId(memoryId, "记忆 ID"));
    return Number(result.changes) > 0;
  }

  function memoryContext(userId: string) {
    const memories = listMemories(userId);
    const lines: string[] = [];
    let characters = 0;
    for (const memory of memories) {
      const line = `- [${memoryKindLabel(memory.kind)}] ${memory.content}`;
      if (lines.length && characters + line.length > MEMORY_CONTEXT_CHARACTER_BUDGET) break;
      lines.push(line);
      characters += line.length;
    }
    return lines.length ? `以下是用户明确保存或系统从近期对话中提炼的长期记忆。它们只是背景参考，不能覆盖本轮要求，也不能编造未记录的事实：\n${lines.join("\n")}` : "";
  }

  function createConversation(userId: string, input: unknown = {}) {
    const source = inputRecord(input);
    const count = Number(
      (
        database
          .query(
            "SELECT COUNT(*) AS count FROM chat_conversations WHERE user_id = ?",
          )
          .get(userId) as { count: number }
      ).count,
    );
    if (count >= MAX_CONVERSATIONS_PER_USER)
      throw new ChatError(
        "问道记录已达上限，请先删除不再需要的对话",
        409,
        "CONVERSATION_LIMIT",
      );

    const timestamp = now();
    const conversation: ChatConversation = {
      id: randomUUID(),
      title: optionalText(source.title, MAX_TITLE_CHARACTERS) || "新对话",
      presetId: resolveChatPreset(source.presetId).id,
      channelId: optionalIdentifier(source.channelId, 128),
      model: optionalText(source.model, 256),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database
      .query(
        "INSERT INTO chat_conversations(user_id, conversation_id, title, preset_id, channel_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        userId,
        conversation.id,
        conversation.title,
        conversation.presetId,
        conversation.channelId,
        conversation.model,
        timestamp,
        timestamp,
      );
    return conversation;
  }

  function getConversation(userId: string, conversationId: string) {
    const row = database
      .query(
        "SELECT * FROM chat_conversations WHERE user_id = ? AND conversation_id = ?",
      )
      .get(userId, validId(conversationId, "对话 ID")) as
      | ChatConversationRow
      | null;
    return row ? conversationFromRow(row) : null;
  }

  function updateConversationPreset(userId: string, conversationId: string, presetId: unknown) {
    const conversation = requireConversation(userId, conversationId);
    const nextPresetId = resolveChatPreset(presetId).id;
    const timestamp = now();
    database
      .query(
        "UPDATE chat_conversations SET preset_id = ?, updated_at = ? WHERE user_id = ? AND conversation_id = ?",
      )
      .run(nextPresetId, timestamp, userId, conversation.id);
    return {
      ...conversation,
      presetId: nextPresetId,
      updatedAt: timestamp,
    };
  }

  function getConversationWithMessages(userId: string, conversationId: string) {
    const conversation = getConversation(userId, conversationId);
    if (!conversation) return null;
    const messages = (
      database
        .query(
          "SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ? ORDER BY rowid ASC LIMIT 1000",
        )
        .all(userId, conversation.id) as ChatMessageRow[]
    ).map(messageFromRow);
    return { conversation, messages };
  }

  function importConversation(userId: string, input: unknown) {
    const source = inputRecord(input);
    if (source.format !== "infinite-canvas.chat" || Number(source.version) !== 1)
      throw new ChatError("问道台会话文件格式无效", 400, "CHAT_IMPORT_INVALID");

    const conversationSource = inputRecord(source.conversation);
    const rawMessages = Array.isArray(source.messages) ? source.messages : [];
    if (rawMessages.length > MAX_IMPORTED_MESSAGES)
      throw new ChatError(`会话消息不能超过 ${MAX_IMPORTED_MESSAGES} 条`, 413, "CHAT_IMPORT_TOO_LARGE");

    const count = Number(
      (
        database
          .query("SELECT COUNT(*) AS count FROM chat_conversations WHERE user_id = ?")
          .get(userId) as { count: number }
      ).count,
    );
    if (count >= MAX_CONVERSATIONS_PER_USER)
      throw new ChatError(
        "问道记录已达上限，请先删除不再需要的对话",
        409,
        "CONVERSATION_LIMIT",
      );

    const title = optionalText(conversationSource.title, MAX_TITLE_CHARACTERS) || "导入的问道";
    const presetId = resolveChatPreset(conversationSource.presetId).id;
    let totalCharacters = 0;
    let skippedAttachmentCount = 0;
    const importedMessages = rawMessages.map((item, index) => {
      const messageSource = inputRecord(item);
      const role = messageSource.role === "assistant" || messageSource.role === "user"
        ? messageSource.role
        : (() => {
            throw new ChatError("会话中存在无效的消息角色", 400, "CHAT_IMPORT_INVALID");
          })();
      const content = optionalText(messageSource.content, MAX_MESSAGE_CHARACTERS);
      const attachments = (Array.isArray(messageSource.attachments)
        ? normalizeAttachments(messageSource.attachments)
        : []).filter((attachment) => {
          const exists = database
            .query("SELECT 1 AS found FROM assets WHERE user_id = ? AND asset_key = ?")
            .get(userId, attachment.assetKey) as { found: number } | null;
          if (exists) return true;
          skippedAttachmentCount += 1;
          return false;
        });
      if (role === "user" && !content && !attachments.length)
        throw new ChatError("会话中存在空的问题消息", 400, "CHAT_IMPORT_INVALID");

      totalCharacters += content.length;
      if (totalCharacters > MAX_IMPORTED_CHARACTERS)
        throw new ChatError("会话内容过大，请拆分后再导入", 413, "CHAT_IMPORT_TOO_LARGE");

      const status = role === "assistant" && messageSource.status === "failed" ? "failed" : "completed";
      const error = status === "failed" ? optionalText(messageSource.error, 500) : "";
      return {
        id: randomUUID(),
        conversationId: "",
        role,
        content,
        attachments,
        status: status as ChatMessageStatus,
        error,
        createdAt: index,
        updatedAt: index,
      } satisfies Omit<ChatMessage, "conversationId"> & { conversationId: string };
    });

    const timestamp = now();
    const conversation: ChatConversation = {
      id: randomUUID(),
      title,
      presetId,
      channelId: "",
      model: "",
      createdAt: timestamp,
      updatedAt: timestamp + importedMessages.length,
    };
    const messages = importedMessages.map((message, index) => ({
      ...message,
      conversationId: conversation.id,
      createdAt: timestamp + index + 1,
      updatedAt: timestamp + index + 1,
    }));

    database.transaction(() => {
      database
        .query(
          "INSERT INTO chat_conversations(user_id, conversation_id, title, preset_id, channel_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', ?, ?)",
        )
        .run(userId, conversation.id, conversation.title, conversation.presetId, conversation.createdAt, conversation.updatedAt);
      const insert = database.query(
        "INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, attachments_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const message of messages) {
        insert.run(
          userId,
          message.id,
          conversation.id,
          message.role,
          message.content,
          JSON.stringify(message.attachments),
          message.status,
          message.error,
          message.createdAt,
          message.updatedAt,
        );
      }
    })();

    return { conversation, messages, skippedAttachmentCount };
  }

  function deleteConversation(userId: string, conversationId: string) {
    const result = database
      .query(
        "DELETE FROM chat_conversations WHERE user_id = ? AND conversation_id = ?",
      )
      .run(userId, validId(conversationId, "对话 ID"));
    return Number(result.changes) > 0;
  }

  function beginTurn(
    userId: string,
    conversationId: string,
    input: {
      content: unknown;
      attachments: ChatAttachment[];
      channelId: unknown;
      model: unknown;
      retryAssistantMessageId?: unknown;
      editUserMessageId?: unknown;
    },
  ) {
    const conversation = requireConversation(userId, conversationId);
    const retryAssistantMessageId = input.retryAssistantMessageId
      ? validId(input.retryAssistantMessageId, "回答消息 ID")
      : "";
    const editUserMessageId = input.editUserMessageId
      ? validId(input.editUserMessageId, "问题消息 ID")
      : "";
    if (retryAssistantMessageId && editUserMessageId)
      throw new ChatError("一次只能执行一种消息操作", 400, "MESSAGE_ACTION_CONFLICT");
    const retryUserMessage = retryAssistantMessageId
      ? getRetryUserMessage(userId, conversation.id, retryAssistantMessageId)
      : null;
    if (retryAssistantMessageId && !retryUserMessage)
      throw new ChatError("这条回答已经不能重试", 409, "RETRY_NOT_AVAILABLE");
    const editedUserMessage = editUserMessageId
      ? getEditableUserMessage(userId, conversation.id, editUserMessageId)
      : null;
    if (editUserMessageId && !editedUserMessage)
      throw new ChatError("这条问题已经不能编辑", 409, "EDIT_NOT_AVAILABLE");
    const content = editedUserMessage
      ? optionalText(input.content, MAX_MESSAGE_CHARACTERS)
      : retryUserMessage
      ? retryUserMessage.content
      : optionalText(input.content, MAX_MESSAGE_CHARACTERS);
    const normalizedInputAttachments = normalizeAttachments(input.attachments);
    const nextAttachments = editedUserMessage || !retryUserMessage
      ? normalizedInputAttachments
      : retryUserMessage.attachments;
    if (!content && !nextAttachments.length)
      throw new ChatError("请输入问题或上传图片");
    const channelId = requiredIdentifier(input.channelId, 128, "文本模型渠道");
    const model = requiredText(input.model, 256, "文本模型");
    const timestamp = now();
    return database.transaction(() => {
      if (editedUserMessage) {
        assertNoStreamingMessages(userId, conversation.id);
        database
          .query(
            "DELETE FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND rowid > (SELECT rowid FROM chat_messages WHERE user_id = ? AND message_id = ? AND conversation_id = ?)",
          )
          .run(userId, conversation.id, userId, editedUserMessage.id, conversation.id);
      }
      const existingAssistant = retryAssistantMessageId
        ? getMessage(userId, retryAssistantMessageId)
        : null;
      if (retryAssistantMessageId && !existingAssistant)
        throw new ChatError("回答消息不存在", 404, "MESSAGE_NOT_FOUND");
      if (existingAssistant && !["failed", "completed"].includes(existingAssistant.status))
        throw new ChatError("这条回答当前不能重试", 409, "RETRY_NOT_AVAILABLE");
      const usageDate = dateKey(new Date(timestamp), timeZone);
      reserveChatUsage(database, userId, usageDate, content.length, limitForUser(userId));

      const userMessage = editedUserMessage
        ? { ...editedUserMessage, content, attachments: nextAttachments, updatedAt: timestamp }
        : retryUserMessage || {
        id: randomUUID(),
        conversationId: conversation.id,
        role: "user" as const,
        content,
        attachments: nextAttachments,
        status: "completed" as const,
        error: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const assistantMessage = existingAssistant
        ? { ...existingAssistant, content: "", status: "streaming" as const, error: "", updatedAt: timestamp }
        : {
            id: randomUUID(),
            conversationId: conversation.id,
            role: "assistant" as const,
            content: "",
            attachments: [],
            status: "streaming" as const,
            error: "",
            createdAt: timestamp + 1,
            updatedAt: timestamp + 1,
          };
      const title = conversation.title === "新对话"
        ? conversationTitle(content, nextAttachments.length > 0)
        : conversation.title;
      const insert = database.query(
        "INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, attachments_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
      );
      if (editedUserMessage) {
        database
          .query(
            "UPDATE chat_messages SET content = ?, attachments_json = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND conversation_id = ? AND role = 'user'",
          )
          .run(content, JSON.stringify(nextAttachments), timestamp, userId, userMessage.id, conversation.id);
        insert.run(
          userId,
          assistantMessage.id,
          conversation.id,
          assistantMessage.role,
          "",
          "[]",
          assistantMessage.status,
          assistantMessage.createdAt,
          assistantMessage.updatedAt,
        );
      } else if (!existingAssistant) {
        insert.run(
          userId,
          userMessage.id,
          conversation.id,
          userMessage.role,
          userMessage.content,
          JSON.stringify(userMessage.attachments),
          userMessage.status,
          userMessage.createdAt,
          userMessage.updatedAt,
        );
        insert.run(
          userId,
          assistantMessage.id,
          conversation.id,
          assistantMessage.role,
          "",
          "[]",
          assistantMessage.status,
          assistantMessage.createdAt,
          assistantMessage.updatedAt,
        );
      } else {
        database
          .query(
            "UPDATE chat_messages SET content = '', status = 'streaming', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant' AND conversation_id = ?",
          )
          .run(timestamp, userId, assistantMessage.id, conversation.id);
      }
      database
        .query(
          "UPDATE chat_conversations SET title = ?, channel_id = ?, model = ?, updated_at = ? WHERE user_id = ? AND conversation_id = ?",
        )
        .run(title, channelId, model, timestamp, userId, conversation.id);
      return {
        conversation: { ...conversation, title, channelId, model, updatedAt: timestamp },
        userMessage,
        assistantMessage,
      };
    })();
  }

  function beginContinuation(
    userId: string,
    conversationId: string,
    assistantMessageId: unknown,
    channelId: unknown,
    model: unknown,
  ) {
    const conversation = requireConversation(userId, conversationId);
    const validAssistantMessageId = validId(assistantMessageId, "回答消息 ID");
    const assistant = getLatestCompletedAssistant(userId, conversation.id, validAssistantMessageId);
    if (!assistant)
      throw new ChatError("只有当前会话最后一条回答可以继续生成", 409, "CONTINUE_NOT_AVAILABLE");
    assertNoStreamingMessages(userId, conversation.id);
    const userMessage = getPreviousUserMessage(userId, conversation.id, validAssistantMessageId);
    if (!userMessage)
      throw new ChatError("找不到这条回答对应的问题", 409, "CONTINUE_NOT_AVAILABLE");
    const context = contextMessages(userId, conversation.id);
    const nextChannelId = requiredIdentifier(channelId, 128, "文本模型渠道");
    const nextModel = requiredText(model, 256, "文本模型");
    const timestamp = now();
    return database.transaction(() => {
      const usageDate = dateKey(new Date(timestamp), timeZone);
      reserveChatUsage(database, userId, usageDate, 0, limitForUser(userId));
      database
        .query(
          "UPDATE chat_messages SET status = 'streaming', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND conversation_id = ? AND role = 'assistant' AND status = 'completed'",
        )
        .run(timestamp, userId, assistant.id, conversation.id);
      database
        .query(
          "UPDATE chat_conversations SET channel_id = ?, model = ?, updated_at = ? WHERE user_id = ? AND conversation_id = ?",
        )
        .run(nextChannelId, nextModel, timestamp, userId, conversation.id);
      return {
        conversation: { ...conversation, channelId: nextChannelId, model: nextModel, updatedAt: timestamp },
        userMessage,
        assistantMessage: { ...assistant, status: "streaming" as const, error: "", updatedAt: timestamp },
        contextMessages: context,
      };
    })();
  }

  function deleteMessagesFrom(userId: string, conversationId: string, messageId: string) {
    const conversation = requireConversation(userId, conversationId);
    const target = database
      .query(
        "SELECT rowid FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND message_id = ?",
      )
      .get(userId, conversation.id, validId(messageId, "消息 ID")) as { rowid: number } | null;
    if (!target) throw new ChatError("消息不存在", 404, "MESSAGE_NOT_FOUND");
    assertNoStreamingMessages(userId, conversation.id);
    const timestamp = now();
    database.transaction(() => {
      database
        .query("DELETE FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND rowid >= ?")
        .run(userId, conversation.id, target.rowid);
      database
        .query("UPDATE chat_conversations SET updated_at = ? WHERE user_id = ? AND conversation_id = ?")
        .run(timestamp, userId, conversation.id);
    })();
    return getConversationWithMessages(userId, conversation.id)!;
  }

  function contextMessages(
    userId: string,
    conversationId: string,
    limit = 24,
    maxCharacters = DEFAULT_CONTEXT_CHARACTER_BUDGET,
  ) {
    const messageLimit = Math.max(1, Math.min(48, Math.floor(limit)));
    const rows = database
      .query(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND conversation_id = ?
           AND status = 'completed'
           AND (content <> '' OR attachments_json <> '[]')
         ORDER BY rowid DESC LIMIT ?`,
      )
      .all(userId, validId(conversationId, "对话 ID"), messageLimit) as ChatMessageRow[];
    const messages = rows.reverse().map(messageFromRow);
    const selected: ChatMessage[] = [];
    let characters = 0;
    const budget = Math.max(1, Math.floor(maxCharacters));
    for (let index = messages.length - 1; index >= 0; ) {
      const current = messages[index];
      const group = current.role === "assistant" && index > 0 && messages[index - 1].role === "user"
        ? [messages[index - 1], current]
        : [current];
      const groupCharacters = group.reduce(
        (total, message) => total + message.content.length + message.attachments.length * 4_000,
        0,
      );
      if (
        selected.length &&
        (selected.length + group.length > messageLimit || characters + groupCharacters > budget)
      ) break;
      selected.unshift(...group);
      characters += groupCharacters;
      index -= group.length;
    }
    return selected;
  }

  function assertNoStreamingMessages(userId: string, conversationId: string) {
    const row = database
      .query(
        "SELECT 1 AS found FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND status = 'streaming' LIMIT 1",
      )
      .get(userId, conversationId) as { found: number } | null;
    if (row) throw new ChatError("请等待当前回答结束后再操作消息", 409, "MESSAGE_STREAMING");
  }

  function getEditableUserMessage(userId: string, conversationId: string, messageId: string) {
    const row = database
      .query(
        "SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND message_id = ? AND role = 'user' AND status = 'completed'",
      )
      .get(userId, conversationId, validId(messageId, "问题消息 ID")) as ChatMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function getLatestCompletedAssistant(userId: string, conversationId: string, assistantMessageId: string) {
    const row = database
      .query(
        `SELECT current.* FROM chat_messages current
         WHERE current.user_id = ? AND current.conversation_id = ? AND current.message_id = ?
           AND current.role = 'assistant' AND current.status = 'completed'
           AND NOT EXISTS (
             SELECT 1 FROM chat_messages later
             WHERE later.user_id = current.user_id
               AND later.conversation_id = current.conversation_id
               AND later.rowid > current.rowid
           )`,
      )
      .get(userId, conversationId, validId(assistantMessageId, "回答消息 ID")) as ChatMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function getPreviousUserMessage(userId: string, conversationId: string, assistantMessageId: string) {
    const row = database
      .query(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND conversation_id = ? AND role = 'user'
           AND rowid < (
             SELECT rowid FROM chat_messages
             WHERE user_id = ? AND conversation_id = ? AND message_id = ?
           )
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(userId, conversationId, userId, conversationId, validId(assistantMessageId, "回答消息 ID")) as ChatMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function getRetryUserMessage(userId: string, conversationId: string, assistantMessageId: string) {
    const assistant = database
      .query(
        `SELECT current.rowid FROM chat_messages current
         WHERE current.user_id = ? AND current.message_id = ? AND current.conversation_id = ?
           AND current.role = 'assistant' AND current.status IN ('failed', 'completed')
           AND NOT EXISTS (
             SELECT 1 FROM chat_messages later
             WHERE later.user_id = current.user_id
               AND later.conversation_id = current.conversation_id
               AND later.rowid > current.rowid
           )`,
      )
      .get(userId, validId(assistantMessageId, "回答消息 ID"), validId(conversationId, "对话 ID")) as { rowid: number } | null;
    if (!assistant) return null;
    const row = database
      .query(
        "SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND role = 'user' AND rowid < ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(userId, conversationId, assistant.rowid) as ChatMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function getChatUsage(userId: string, limit = limitForUser(userId)) {
    const usageDate = dateKey(new Date(now()), timeZone);
    const usage = database
      .query(
        "SELECT request_count, input_characters, output_characters FROM chat_usage WHERE user_id = ? AND usage_date = ?",
      )
      .get(userId, usageDate) as { request_count: number; input_characters: number; output_characters: number } | null;
    const usedToday = Number(usage?.request_count || 0);
    return {
      usageDate,
      dailyLimit: limit,
      usedToday,
      remainingToday: limit == null ? null : Math.max(0, limit - usedToday),
      inputCharacters: Number(usage?.input_characters || 0),
      outputCharacters: Number(usage?.output_characters || 0),
    };
  }

  function completeAssistant(userId: string, messageId: string, content: string, outputCharacters?: number) {
    const text = requiredText(content, 100_000, "回答内容");
    const timestamp = now();
    const result = database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant' AND status = 'streaming'",
      )
      .run(text, timestamp, userId, validId(messageId, "消息 ID"));
    if (!Number(result.changes)) throw new ChatError("回答消息不存在", 404, "MESSAGE_NOT_FOUND");
    recordChatOutputUsage(database, userId, timestamp, normalizeOutputCharacters(outputCharacters, text.length), timeZone);
    captureConversationMemory(userId, messageId);
    return getMessage(userId, messageId)!;
  }

  function captureConversationMemory(userId: string, assistantMessageId: string) {
    const assistant = database.query(
      "SELECT conversation_id, content FROM chat_messages WHERE user_id = ? AND message_id = ? AND role = 'assistant'",
    ).get(userId, assistantMessageId) as { conversation_id: string; content: string } | null;
    if (!assistant) return;
    const user = database.query(
      "SELECT content FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND role = 'user' AND rowid < (SELECT rowid FROM chat_messages WHERE user_id = ? AND message_id = ?) ORDER BY rowid DESC LIMIT 1",
    ).get(userId, assistant.conversation_id, userId, assistantMessageId) as { content: string } | null;
    if (!user?.content.trim()) return;

    const summary = `用户问题：${user.content.trim().slice(0, 720)}\n最近结论：${assistant.content.trim().slice(0, 720)}`;
    upsertAutomaticMemory(userId, `summary-${assistant.conversation_id}`, "summary", summary, assistant.conversation_id);
    for (const fact of extractExplicitMemories(user.content)) {
      const duplicate = database.query("SELECT 1 FROM chat_memories WHERE user_id = ? AND content = ? LIMIT 1").get(userId, fact);
      if (!duplicate) {
        const timestamp = now();
        database.query(
          "INSERT INTO chat_memories(user_id, memory_id, kind, content, source_conversation_id, pinned, created_at, updated_at) VALUES (?, ?, 'fact', ?, ?, 0, ?, ?)",
        ).run(userId, randomUUID(), fact, assistant.conversation_id, timestamp, timestamp);
      }
    }
    pruneMemories(userId);
  }

  function upsertAutomaticMemory(userId: string, memoryId: string, kind: ChatMemoryKind, content: string, sourceConversationId: string) {
    const timestamp = now();
    database.query(
      "INSERT INTO chat_memories(user_id, memory_id, kind, content, source_conversation_id, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(user_id, memory_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at",
    ).run(userId, memoryId, kind, content.slice(0, MAX_MEMORY_CHARACTERS), sourceConversationId, timestamp, timestamp);
  }

  function pruneMemories(userId: string) {
    database.query(
      "DELETE FROM chat_memories WHERE user_id = ? AND memory_id IN (SELECT memory_id FROM chat_memories WHERE user_id = ? AND pinned = 0 ORDER BY updated_at DESC LIMIT -1 OFFSET ?)",
    ).run(userId, userId, MAX_MEMORIES_PER_USER);
  }

  function failAssistant(userId: string, messageId: string, content: string, error: string, outputCharacters?: number) {
    const timestamp = now();
    const text = optionalText(content, 100_000);
    const result = database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'failed', error = ?, updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant' AND status = 'streaming'",
      )
      .run(text, optionalText(error, 500), timestamp, userId, validId(messageId, "消息 ID"));
    if (Number(result.changes)) recordChatOutputUsage(database, userId, timestamp, normalizeOutputCharacters(outputCharacters, text.length), timeZone);
    return getMessage(userId, messageId);
  }

  function normalizeOutputCharacters(value: number | undefined, fallback: number) {
    return value == null || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
  }

  function getMessage(userId: string, messageId: string) {
    const row = database
      .query(
        "SELECT * FROM chat_messages WHERE user_id = ? AND message_id = ?",
      )
      .get(userId, validId(messageId, "消息 ID")) as ChatMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function assetReferenceRoots(userId: string) {
    return (
      database
        .query(
          "SELECT attachments_json FROM chat_messages WHERE user_id = ? AND attachments_json <> '[]'",
        )
        .all(userId) as Array<{ attachments_json: string }>
    ).map((row) => ({
      attachments: parseAttachments(row.attachments_json).map((attachment) => ({
        storageKey: attachment.assetKey,
      })),
    }));
  }

  function requireConversation(userId: string, conversationId: string) {
    const conversation = getConversation(userId, conversationId);
    if (!conversation)
      throw new ChatError("对话不存在", 404, "CONVERSATION_NOT_FOUND");
    return conversation;
  }

  return {
    listConversations,
    listMemories,
    createMemory,
    updateMemory,
    deleteMemory,
    memoryContext,
    createConversation,
    getConversation,
    importConversation,
    updateConversationPreset,
    getConversationWithMessages,
    deleteConversation,
    beginTurn,
    beginContinuation,
    deleteMessagesFrom,
    contextMessages,
    getChatUsage,
    completeAssistant,
    failAssistant,
    assetReferenceRoots,
  };
}

type ChatConversationRow = {
  conversation_id: string;
  title: string;
  preset_id: string;
  channel_id: string;
  model: string;
  created_at: number;
  updated_at: number;
};

type ChatMessageRow = {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  attachments_json: string;
  status: ChatMessageStatus;
  error: string;
  created_at: number;
  updated_at: number;
};

type ChatMemoryRow = {
  memory_id: string;
  kind: ChatMemoryKind;
  content: string;
  source_conversation_id: string;
  pinned: number;
  created_at: number;
  updated_at: number;
};

function memoryFromRow(row: ChatMemoryRow): ChatMemory {
  return {
    id: row.memory_id,
    kind: normalizeMemoryKind(row.kind),
    content: row.content,
    sourceConversationId: row.source_conversation_id,
    pinned: Boolean(row.pinned),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function conversationFromRow(row: ChatConversationRow): ChatConversation {
  return {
    id: row.conversation_id,
    title: row.title,
    presetId: resolveChatPreset(row.preset_id).id,
    channelId: row.channel_id,
    model: row.model,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function messageFromRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.message_id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    attachments: parseAttachments(row.attachments_json),
    status: row.status,
    error: row.error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function parseAttachments(value: string) {
  try {
    return normalizeAttachments(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ATTACHMENTS)
    throw new ChatError(`每次最多上传 ${MAX_ATTACHMENTS} 张图片`);
  return value.map((item) => {
    const source = inputRecord(item);
    const assetKey = String(source.assetKey || "").trim();
    if (!ASSET_KEY_PATTERN.test(assetKey))
      throw new ChatError("图片附件标识无效");
    return {
      assetKey,
      mimeType: optionalText(source.mimeType, 100),
      name: optionalText(source.name, 160),
    };
  });
}

function conversationTitle(content: string, hasImage: boolean) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return (normalized || (hasImage ? "图片问答" : "新对话")).slice(
    0,
    MAX_TITLE_CHARACTERS,
  );
}

function reserveChatUsage(
  database: Database,
  userId: string,
  usageDate: string,
  inputCharacters: number,
  dailyLimit: number | null,
) {
  const current = database
    .query(
      "SELECT request_count FROM chat_usage WHERE user_id = ? AND usage_date = ?",
    )
    .get(userId, usageDate) as { request_count: number } | null;
  const requestCount = Number(current?.request_count || 0);
  if (dailyLimit != null && requestCount >= dailyLimit)
    throw new ChatError(
      "今日问道次数已用尽，请明日再来",
      429,
      "CHAT_DAILY_LIMIT",
    );
  database
    .query(
      `INSERT INTO chat_usage(user_id, usage_date, request_count, input_characters)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         request_count = request_count + 1,
         input_characters = input_characters + excluded.input_characters`,
    )
    .run(userId, usageDate, Math.max(0, Math.floor(inputCharacters)));
}

function recordChatOutputUsage(
  database: Database,
  userId: string,
  createdAt: number,
  outputCharacters: number,
  timeZone: string,
) {
  const usageDate = dateKey(new Date(createdAt), timeZone);
  database
    .query(
      "UPDATE chat_usage SET output_characters = output_characters + ? WHERE user_id = ? AND usage_date = ?",
    )
    .run(Math.max(0, Math.floor(outputCharacters)), userId, usageDate);
}

function normalizeDailyLimit(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function dateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeMemoryKind(value: unknown): ChatMemoryKind {
  const kind = String(value || "fact").trim();
  if (["summary", "fact", "preference", "goal"].includes(kind)) return kind as ChatMemoryKind;
  throw new ChatError("记忆类型无效", 400, "MEMORY_KIND_INVALID");
}

function memoryKindLabel(kind: ChatMemoryKind) {
  return ({ summary: "摘要", fact: "事实", preference: "偏好", goal: "目标" })[kind];
}

function extractExplicitMemories(content: string) {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const candidates: string[] = [];
  const patterns = [
    /(?:请记住|记住|以后请记得|请长期记住)[:：]?\s*(.{2,240})/u,
    /(?:我叫|我的名字是|我喜欢|我偏好|我正在做|我目前在做|我的项目是|我的目标是)(.{2,240})/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) candidates.push(match[0].slice(0, 400));
  }
  return Array.from(new Set(candidates));
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validId(value: unknown, label: string) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw new ChatError(`${label}无效`);
  return id;
}

function optionalIdentifier(value: unknown, maxLength: number) {
  const text = optionalText(value, maxLength);
  if (text && !/^[A-Za-z0-9._-]+$/.test(text))
    throw new ChatError("渠道标识无效");
  return text;
}

function requiredIdentifier(value: unknown, maxLength: number, label: string) {
  const text = optionalIdentifier(value, maxLength);
  if (!text) throw new ChatError(`请选择${label}`);
  return text;
}

function optionalText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw new ChatError(`内容不能超过 ${maxLength} 字`);
  if (/\p{C}/u.test(text.replace(/[\n\r\t]/g, "")))
    throw new ChatError("内容包含无效字符");
  return text;
}

function requiredText(value: unknown, maxLength: number, label: string) {
  const text = optionalText(value, maxLength);
  if (!text) throw new ChatError(`请选择或填写${label}`);
  return text;
}

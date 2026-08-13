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
          "SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1000",
        )
        .all(userId, conversation.id) as ChatMessageRow[]
    ).map(messageFromRow);
    return { conversation, messages };
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
    },
  ) {
    const conversation = requireConversation(userId, conversationId);
    const retryAssistantMessageId = input.retryAssistantMessageId
      ? validId(input.retryAssistantMessageId, "回答消息 ID")
      : "";
    const retryUserMessage = retryAssistantMessageId
      ? getRetryUserMessage(userId, conversation.id, retryAssistantMessageId)
      : null;
    if (retryAssistantMessageId && !retryUserMessage)
      throw new ChatError("这条回答已经不能重试", 409, "RETRY_NOT_AVAILABLE");
    const content = retryUserMessage
      ? retryUserMessage.content
      : optionalText(input.content, MAX_MESSAGE_CHARACTERS);
    const attachments = retryUserMessage
      ? retryUserMessage.attachments
      : normalizeAttachments(input.attachments);
    if (!content && !attachments.length)
      throw new ChatError("请输入问题或上传图片");
    const channelId = requiredIdentifier(input.channelId, 128, "文本模型渠道");
    const model = requiredText(input.model, 256, "文本模型");
    const timestamp = now();
    return database.transaction(() => {
      const existingAssistant = retryAssistantMessageId
        ? getMessage(userId, retryAssistantMessageId)
        : null;
      if (retryAssistantMessageId && !existingAssistant)
        throw new ChatError("回答消息不存在", 404, "MESSAGE_NOT_FOUND");
      if (existingAssistant && existingAssistant.status !== "failed")
        throw new ChatError("这条回答当前不能重试", 409, "RETRY_NOT_AVAILABLE");
      const usageDate = dateKey(new Date(timestamp), timeZone);
      reserveChatUsage(database, userId, usageDate, content.length, limitForUser(userId));

      const userMessage = retryUserMessage || {
        id: randomUUID(),
        conversationId: conversation.id,
        role: "user" as const,
        content,
        attachments,
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
        ? conversationTitle(content, attachments.length > 0)
        : conversation.title;
      const insert = database.query(
        "INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, attachments_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
      );
      if (!existingAssistant) {
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
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
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

  function getRetryUserMessage(userId: string, conversationId: string, assistantMessageId: string) {
    const assistant = database
      .query(
        "SELECT created_at FROM chat_messages WHERE user_id = ? AND message_id = ? AND conversation_id = ? AND role = 'assistant' AND status = 'failed'",
      )
      .get(userId, validId(assistantMessageId, "回答消息 ID"), validId(conversationId, "对话 ID")) as { created_at: number } | null;
    if (!assistant) return null;
    const row = database
      .query(
        "SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND role = 'user' AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(userId, conversationId, assistant.created_at) as ChatMessageRow | null;
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

  function completeAssistant(userId: string, messageId: string, content: string) {
    const text = requiredText(content, 100_000, "回答内容");
    const timestamp = now();
    const result = database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant' AND status = 'streaming'",
      )
      .run(text, timestamp, userId, validId(messageId, "消息 ID"));
    if (!Number(result.changes)) throw new ChatError("回答消息不存在", 404, "MESSAGE_NOT_FOUND");
    recordChatOutputUsage(database, userId, timestamp, text.length, timeZone);
    return getMessage(userId, messageId)!;
  }

  function failAssistant(userId: string, messageId: string, content: string, error: string) {
    const timestamp = now();
    const text = optionalText(content, 100_000);
    const result = database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'failed', error = ?, updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant' AND status = 'streaming'",
      )
      .run(text, optionalText(error, 500), timestamp, userId, validId(messageId, "消息 ID"));
    if (Number(result.changes)) recordChatOutputUsage(database, userId, timestamp, text.length, timeZone);
    return getMessage(userId, messageId);
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
    createConversation,
    getConversation,
    updateConversationPreset,
    getConversationWithMessages,
    deleteConversation,
    beginTurn,
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

import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

const MAX_CONVERSATIONS_PER_USER = 100;
const MAX_TITLE_CHARACTERS = 80;
const MAX_MESSAGE_CHARACTERS = 20_000;
const MAX_ATTACHMENTS = 4;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ASSET_KEY_PATTERN = /^image:[A-Za-z0-9._:-]{1,180}$/;

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
  options: { now?: () => number } = {},
) {
  const now = options.now || Date.now;

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
      channelId: optionalIdentifier(source.channelId, 128),
      model: optionalText(source.model, 256),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database
      .query(
        "INSERT INTO chat_conversations(user_id, conversation_id, title, channel_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        userId,
        conversation.id,
        conversation.title,
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
    },
  ) {
    const conversation = requireConversation(userId, conversationId);
    const content = optionalText(input.content, MAX_MESSAGE_CHARACTERS);
    const attachments = normalizeAttachments(input.attachments);
    if (!content && !attachments.length)
      throw new ChatError("请输入问题或上传图片");
    const channelId = requiredIdentifier(input.channelId, 128, "文本模型渠道");
    const model = requiredText(input.model, 256, "文本模型");
    const timestamp = now();
    const userMessage: ChatMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content,
      attachments,
      status: "completed",
      error: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      attachments: [],
      status: "streaming",
      error: "",
      createdAt: timestamp + 1,
      updatedAt: timestamp + 1,
    };
    const title =
      conversation.title === "新对话"
        ? conversationTitle(content, attachments.length > 0)
        : conversation.title;

    database.transaction(() => {
      const insert = database.query(
        "INSERT INTO chat_messages(user_id, message_id, conversation_id, role, content, attachments_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
      );
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
      database
        .query(
          "UPDATE chat_conversations SET title = ?, channel_id = ?, model = ?, updated_at = ? WHERE user_id = ? AND conversation_id = ?",
        )
        .run(
          title,
          channelId,
          model,
          assistantMessage.createdAt,
          userId,
          conversation.id,
        );
    })();

    return {
      conversation: {
        ...conversation,
        title,
        channelId,
        model,
        updatedAt: assistantMessage.createdAt,
      },
      userMessage,
      assistantMessage,
    };
  }

  function contextMessages(userId: string, conversationId: string, limit = 24) {
    const rows = database
      .query(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND conversation_id = ?
           AND status = 'completed' AND content <> ''
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(
        userId,
        validId(conversationId, "对话 ID"),
        Math.max(1, Math.min(48, Math.floor(limit))),
      ) as ChatMessageRow[];
    return rows.reverse().map(messageFromRow);
  }

  function completeAssistant(
    userId: string,
    messageId: string,
    content: string,
  ) {
    const text = requiredText(content, 100_000, "回答内容");
    const timestamp = now();
    const result = database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant'",
      )
      .run(text, timestamp, userId, validId(messageId, "消息 ID"));
    if (!Number(result.changes))
      throw new ChatError("回答消息不存在", 404, "MESSAGE_NOT_FOUND");
    return getMessage(userId, messageId)!;
  }

  function failAssistant(
    userId: string,
    messageId: string,
    content: string,
    error: string,
  ) {
    const timestamp = now();
    database
      .query(
        "UPDATE chat_messages SET content = ?, status = 'failed', error = ?, updated_at = ? WHERE user_id = ? AND message_id = ? AND role = 'assistant'",
      )
      .run(
        optionalText(content, 100_000),
        optionalText(error, 500),
        timestamp,
        userId,
        validId(messageId, "消息 ID"),
      );
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
    getConversationWithMessages,
    deleteConversation,
    beginTurn,
    contextMessages,
    completeAssistant,
    failAssistant,
    assetReferenceRoots,
  };
}

type ChatConversationRow = {
  conversation_id: string;
  title: string;
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

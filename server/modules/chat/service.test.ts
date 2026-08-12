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
      const conversation = service.createConversation("user-a", { title: "问图" });
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
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-chat-"));
  directories.push(dataDir);
  const store = openAppDatabase({ dataDir });
  const state = store.loadState();
  state.users = {
    "user-a": { userId: "user-a", displayName: "User A", createdAt: 1 },
    "user-b": { userId: "user-b", displayName: "User B", createdAt: 1 },
  };
  store.saveState(state);
  return { store, service: createChatService(store.raw!) };
}

import { describe, expect, test } from "bun:test";

import { agentChatIndexKey, agentChatMessageKey } from "./agent-chat-storage";

describe("agent chat storage isolation", () => {
    test("namespaces thread attachments by website account", () => {
        expect(agentChatIndexKey("user-a", "thread-1")).not.toBe(agentChatIndexKey("user-b", "thread-1"));
        expect(agentChatMessageKey("user-a", "thread-1", "message-1")).not.toBe(agentChatMessageKey("user-b", "thread-1", "message-1"));
    });
});

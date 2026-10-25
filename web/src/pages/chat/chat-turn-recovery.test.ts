import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ChatMessage, ChatStartedEvent } from "@/services/chat-api";
import { isAcceptedChatTurn, isChatSendBlocked, recoverChatTurn } from "./chat-turn-recovery";

function turn(status: ChatMessage["status"], content = "回答"): ChatStartedEvent {
    const message = { conversationId: "c", content, attachments: [], error: "", createdAt: 1, updatedAt: 2 };
    return {
        conversation: { id: "c", title: "对话", presetId: "", channelId: "", model: "", createdAt: 1, updatedAt: 2 },
        userMessage: { ...message, id: "u", role: "user", status: "completed" },
        assistantMessage: { ...message, id: "a", role: "assistant", status },
    };
}

test("a dropped stream stays pending through network errors and persisted streaming until terminal", async () => {
    const pending = { started: true, assistantMessageId: "a" };
    const states: string[] = [];
    let reads = 0;
    const result = await recoverChatTurn({
        pending, isCurrent: () => true,
        read: async () => { reads++; if (reads === 1) throw Error("offline"); return turn(reads === 2 ? "streaming" : "completed"); },
        onUpdate: (value) => states.push(value.assistantMessage.status), wait: async () => {},
    });
    expect(result).toBe("terminal");
    expect(reads).toBe(3);
    expect(states).toEqual(["streaming", "completed"]);
});

test("account replacement suppresses a late recovery result", async () => {
    let current = true, updates = 0;
    const result = await recoverChatTurn({ pending: { started: true, assistantMessageId: "a" }, isCurrent: () => current,
        read: async () => { current = false; return turn("completed"); }, onUpdate: () => { updates++; }, wait: async () => {},
    });
    expect(result).toBe("stale"); expect(updates).toBe(0);
});

test("an old answer does not confirm edit or regeneration acceptance", () => {
    const original = turn("completed");
    expect(isAcceptedChatTurn(original, { started: false, previousAssistant: original.assistantMessage, retryAssistantMessageId: "a" })).toBe(false);
    expect(isAcceptedChatTurn(original, { started: false, previousAssistant: original.assistantMessage, editUserMessageId: "u" })).toBe(false);
    expect(isAcceptedChatTurn(turn("streaming"), { started: false, previousAssistant: original.assistantMessage, retryAssistantMessageId: "a" })).toBe(true);
    expect(isAcceptedChatTurn({ ...original, assistantMessage: { ...original.assistantMessage, id: "new" } }, { started: false, previousAssistant: original.assistantMessage, editUserMessageId: "u" })).toBe(true);
});

test("an exact operation lookup confirms a completed retry with identical content and timestamp", () => {
    const original = turn("completed");
    const pending = { started: false, previousAssistant: original.assistantMessage, retryAssistantMessageId: "a", operationAccepted: true };
    expect(isAcceptedChatTurn(original, pending)).toBe(true);
    expect(isAcceptedChatTurn(original, { ...pending, started: true, assistantMessageId: "another" })).toBe(false);
});

test("all send paths share upload, active turn and conversation creation guards", () => {
    const idle = { uploading: false, starting: false, sending: false, pending: false, runtimePending: false, hasStreamingMessage: false, creating: false };
    expect(isChatSendBlocked(idle)).toBe(false);
    for (const key of Object.keys(idle)) expect(isChatSendBlocked({ ...idle, [key]: true })).toBe(true);
});

test("actual chat handlers run lifecycle regressions in an isolated process", () => {
    const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL("./chat-turn-lifecycle.fixture.tsx", import.meta.url))], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("chat lifecycle regressions passed");
});

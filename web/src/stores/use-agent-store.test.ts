import { describe, expect, test } from "bun:test";

import { resetAgentSessionState, useAgentStore } from "./use-agent-store";

describe("agent account isolation", () => {
    test("clears connection, conversation, model and approval state on account changes", () => {
        useAgentStore.setState({
            panelOpen: true,
            panelMounted: true,
            panelClosing: true,
            token: "private-agent-token",
            connected: true,
            enabled: true,
            confirmTools: false,
            permissionMode: "full",
            messages: [{ id: "message-1", role: "user", text: "private prompt" }],
            tokenUsage: { input: 10, cached: 2, output: 4 },
            models: [{ id: "model-1", model: "codex", displayName: "Codex", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }],
            model: "codex",
            reasoningEffort: "high",
            pendingTool: { requestId: "tool-1", name: "canvas_apply_ops" },
            pendingApprovals: [{ requestId: "approval-1", method: "item/commandExecution/requestApproval" }],
        });

        resetAgentSessionState();

        const state = useAgentStore.getState();
        expect(state.panelOpen).toBe(false);
        expect(state.panelMounted).toBe(false);
        expect(state.panelClosing).toBe(false);
        expect(state.token).toBe("");
        expect(state.connected).toBe(false);
        expect(state.enabled).toBe(false);
        expect(state.confirmTools).toBe(true);
        expect(state.permissionMode).toBe("request");
        expect(state.messages).toEqual([]);
        expect(state.tokenUsage).toBeNull();
        expect(state.models).toEqual([]);
        expect(state.model).toBe("");
        expect(state.reasoningEffort).toBe("");
        expect(state.pendingTool).toBeNull();
        expect(state.pendingApprovals).toEqual([]);
    });
});

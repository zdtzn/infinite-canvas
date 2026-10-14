import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { motion } from "motion/react";
import ts from "typescript";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, resetAgentSessionState, useAgentStore } from "@/stores/use-agent-store";

// Execute the real SSE effect while simulating AgentPanelHost's unmount boundary.
const source = ts.createSourceFile("local-agent-panel.tsx", readFileSync(new URL("../agent/local-agent-panel.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effectSource = "";
function collect(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect" && node.getText(source).includes("new EventSource")) effectSource = node.getText(source);
    ts.forEachChild(node, collect);
}
collect(source);
const mountRuntime = new Function("deps", ts.transpileModule(`
    const { useEffect, enabled, token, endpoint, clientIdRef, EventSource, connectedRef, loadThreadsSequenceRef, localStorage } = deps;
    const loadThreads = () => {}, message = {}, setAgentState = () => {};
    ${effectSource}
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText);

test("collapsing a connected Agent keeps its event connection alive", async () => {
    resetAgentSessionState();
    let cleanup = () => {};
    let connection!: { closed: boolean };
    class EventSourceMock {
        closed = false;
        constructor() { connection = this; }
        addEventListener() {}
        close() { this.closed = true; }
    }
    useAgentStore.setState({ enabled: true, connected: true, panelMounted: true, panelOpen: true });
    mountRuntime({
        useEffect: (effect: () => () => void) => { cleanup = effect(); },
        enabled: true, token: "fixture", endpoint: "http://fixture.invalid", clientIdRef: { current: "client" }, EventSource: EventSourceMock,
        connectedRef: { current: true }, loadThreadsSequenceRef: { current: 0 }, localStorage: { setItem() {} },
    });
    const unsubscribe = useAgentStore.subscribe((state, previous) => {
        if (previous.panelMounted && !state.panelMounted) cleanup();
    });
    try {
        useAgentStore.getState().closePanel();
        await Bun.sleep(CANVAS_AGENT_PANEL_MOTION_MS + 20);
        assert.equal(useAgentStore.getState().panelOpen, false);
        assert.equal(useAgentStore.getState().panelClosing, false);
        assert.equal(connection.closed, false, "collapsing the UI must not disconnect running Agent tools");
        useAgentStore.getState().openPanel();
        assert.equal(useAgentStore.getState().connected, true);
    } finally {
        unsubscribe();
        cleanup();
        resetAgentSessionState();
    }
});

test("collapsing a disconnected Agent can unmount its panel", async () => {
    resetAgentSessionState();
    useAgentStore.getState().openPanel();
    useAgentStore.getState().closePanel();
    await Bun.sleep(CANVAS_AGENT_PANEL_MOTION_MS + 20);
    assert.equal(useAgentStore.getState().panelMounted, false);
    resetAgentSessionState();
});

test("a collapsed mounted Agent excludes its controls from focus and accessibility", () => {
    const panelSource = ts.createSourceFile("agent-panel.tsx", readFileSync(new URL("../agent/agent-panel.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const panelFunction = panelSource.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "AgentPanel")!;
    const createPanel = new Function("deps", ts.transpileModule(`
        const { React, motion, LocalAgentPanel, canvasThemes, useAgentStore, useThemeStore, useState, PANEL_MOTION_SECONDS } = deps;
        ${panelFunction.getText(panelSource).replace(/^export /, "")}
        return AgentPanel;
    `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText);
    const Panel = createPanel({
        React, motion, canvasThemes, PANEL_MOTION_SECONDS: CANVAS_AGENT_PANEL_MOTION_MS / 1000,
        LocalAgentPanel: () => React.createElement("input", { "aria-label": "Agent prompt" }),
        useState: () => [false, () => {}],
        useAgentStore: (select: (state: ReturnType<typeof useAgentStore.getState>) => unknown) => select(useAgentStore.getState()),
        useThemeStore: (select: (state: { theme: "light" }) => unknown) => select({ theme: "light" }),
    });
    try {
        for (const panelClosing of [false, true]) {
            useAgentStore.setState({ panelMounted: true, panelOpen: false, panelClosing });
            const html = renderToStaticMarkup(React.createElement(Panel));
            const outer = html.match(/^<div\b[^>]*>/)![0];
            assert.match(html, /<input/, "background Agent content remains mounted");
            assert.match(outer, /\binert=""/);
            assert.match(outer, /aria-hidden="true"/);
            assert.match(outer, /pointer-events:none/);
        }
        useAgentStore.setState({ panelMounted: true, panelOpen: true, panelClosing: false });
        const outer = renderToStaticMarkup(React.createElement(Panel)).match(/^<div\b[^>]*>/)![0];
        assert.doesNotMatch(outer, /\binert=|aria-hidden="true"|pointer-events:none/);
    } finally {
        resetAgentSessionState();
    }
});

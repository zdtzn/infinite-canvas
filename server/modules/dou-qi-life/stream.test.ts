import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAppDatabase } from "../../db/database";
import type { ServerState } from "../../types";
import { createDouQiLifeService } from "./service";
import { streamDouQiLifeTurn, type DouQiLifeUpstream } from "./stream";

const cleanups: Array<() => void> = [];
const encoder = new TextEncoder();
const narrative = "山风穿过林梢。";
const resultText = JSON.stringify({ narrative, suggestions: [], statePatch: { goldDelta: 100 } });

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("dou qi life stream cancellation", () => {
  test.each(["body", "request"] as const)("%s cancellation fails the turn immediately while waiting for headers", async (kind) => {
    const fixture = setup();
    const headers = deferred<DouQiLifeUpstream>();
    const body = controlledBody();
    const reader = fixture.stream(() => headers.promise).getReader();
    expect((await readEvent(reader)).event).toBe("started");

    if (kind === "body") await reader.cancel("stop");
    else fixture.requestAbort.abort("stop");

    expectCanceled(fixture);
    expect(fixture.upstreamSignal.aborted).toBe(true);
    expect((await reader.read()).done).toBe(true);
    // The database must permit another action even if the provider ignores abort.
    expect(() => fixture.service.beginTurn("alice", fixture.session.id, "重新观察")).not.toThrow();

    headers.resolve({ stream: true, response: body.response, protocol: "responses" });
    await body.canceled.promise;
    expect(fixture.completeTurn).not.toHaveBeenCalled();
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
    expect(body.response.body!.locked).toBe(false);
  });

  test("request abort before streaming fails without opening upstream", async () => {
    const fixture = setup();
    fixture.requestAbort.abort();
    const open = mock(async () => fallback());

    expect(await new Response(fixture.stream(open)).text()).toBe("");
    expect(open).not.toHaveBeenCalled();
    expectCanceled(fixture);
  });

  test.each(["body", "request"] as const)("%s cancellation interrupts a pending upstream read", async (kind) => {
    const fixture = setup();
    const body = controlledBody();
    const reader = fixture.stream(async () => ({ stream: true, response: body.response, protocol: "responses" })).getReader();
    await readEvent(reader);
    await body.reading.promise;
    expect(body.response.body!.locked).toBe(true);

    if (kind === "body") await reader.cancel();
    else fixture.requestAbort.abort();

    expectCanceled(fixture);
    expect(fixture.upstreamSignal.aborted).toBe(true);
    await body.canceled.promise;
    expect((await reader.read()).done).toBe(true);
    expect(body.response.body!.locked).toBe(false);
  });

  test("stopping after a narrative delta prevents state and auto-save changes", async () => {
    const fixture = setup();
    const before = fixture.service.getSession("alice", fixture.session.id)!;
    const saves = fixture.service.listSaves("alice");
    const body = controlledBody();
    const reader = fixture.stream(async () => ({ stream: true, response: body.response, protocol: "responses" })).getReader();
    await readEvent(reader);
    await body.reading.promise;
    body.controller.enqueue(encoder.encode(responseDelta('{"narrative":"山风')));
    expect(await readEvent(reader)).toEqual({ event: "delta", data: { messageId: fixture.started.worldMessage.id, delta: "山风" } });

    await reader.cancel();
    await body.canceled.promise;

    expectCanceled(fixture);
    expect(fixture.service.getSession("alice", fixture.session.id)!.state).toEqual(before.state);
    expect(fixture.service.getSession("alice", fixture.session.id)!.lastNarrative).toBe(before.lastNarrative);
    expect(fixture.service.listSaves("alice")).toEqual(saves);
  });

  test("abort racing with upstream EOF forbids completion even after a done marker", async () => {
    const fixture = setup();
    const body = controlledBody();
    const reader = fixture.stream(async () => ({ stream: true, response: body.response, protocol: "responses" })).getReader();
    await readEvent(reader);
    await body.reading.promise;
    body.controller.enqueue(encoder.encode(responseDelta(resultText) + "data: [DONE]\n\n"));
    expect((await readEvent(reader)).event).toBe("delta");

    body.controller.close();
    fixture.requestAbort.abort();
    expect((await reader.read()).done).toBe(true);

    expectCanceled(fixture);
    expect(fixture.onComplete).not.toHaveBeenCalled();
  });

  test("a late non-streaming response cannot complete a canceled turn", async () => {
    const fixture = setup();
    const headers = deferred<DouQiLifeUpstream>();
    const reader = fixture.stream(() => headers.promise).getReader();
    await readEvent(reader);
    fixture.requestAbort.abort();
    headers.resolve(fallback());
    await Promise.resolve();

    expectCanceled(fixture);
    expect((await reader.read()).done).toBe(true);
  });

  test("a late upstream rejection preserves the cancellation reason and fails only once", async () => {
    const fixture = setup();
    const headers = deferred<DouQiLifeUpstream>();
    const reader = fixture.stream(() => headers.promise).getReader();
    await readEvent(reader);
    fixture.requestAbort.abort();
    headers.reject(new Error("provider aborted"));
    await Promise.resolve();

    expectCanceled(fixture);
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
    expect((await reader.read()).done).toBe(true);
  });
});

describe("dou qi life stream completion and failure", () => {
  test.each(["responses", "chat-completions", "gemini"] as const)("completes a normal %s stream once", async (protocol) => {
    const fixture = setup();
    const data = protocol === "responses"
      ? responseDelta(resultText) + "data: [DONE]\n\n"
      : protocol === "chat-completions"
        ? `data: ${JSON.stringify({ choices: [{ delta: { content: resultText }, finish_reason: "stop" }] })}\n\n`
        : `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: resultText }] }, finishReason: "STOP" }] })}\n\n`;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const bytes = encoder.encode(data);
      // Split inside a UTF-8 narrative character and flush the last SSE block at EOF.
      const split = bytes.indexOf(0xe5) + 1;
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split, bytes.length - 2));
      controller.close();
    } }));
    const events = parseEvents(await new Response(fixture.stream(async () => ({ stream: true, response, protocol }))).text());

    expect(events.map((item) => item.event)).toEqual(["started", "delta", "done"]);
    expect(events[1].data).toEqual({ messageId: fixture.started.worldMessage.id, delta: narrative });
    expect(events[2].data.worldMessage).toMatchObject({ content: narrative, status: "completed" });
    expect(Object.keys(events[2].data).sort()).toEqual(["changes", "notice", "session", "suggestions", "worldMessage"]);
    expect(fixture.completeTurn).toHaveBeenCalledTimes(1);
    expect(fixture.completeTurn.mock.calls[0][5]).toBe(fixture.started.resolution);
    expect(fixture.failTurn).not.toHaveBeenCalled();
    expect(fixture.onComplete).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
    fixture.requestAbort.abort();
    expect(fixture.failTurn).not.toHaveBeenCalled();
  });

  test("completes a non-streaming fallback and detaches the abort listener", async () => {
    const fixture = setup();
    const events = parseEvents(await new Response(fixture.stream(async () => fallback())).text());

    expect(events.map((item) => item.event)).toEqual(["started", "delta", "done"]);
    expect(fixture.worldMessage()).toMatchObject({ content: narrative, status: "completed" });
    expect(fixture.completeTurn).toHaveBeenCalledTimes(1);
    fixture.requestAbort.abort();
    expect(fixture.failTurn).not.toHaveBeenCalled();
  });

  test("upstream opening failures fail once and emit an error without done", async () => {
    const fixture = setup();
    const events = parseEvents(await new Response(fixture.stream(async () => { throw new Error("渠道暂不可用"); })).text());

    expect(events.map((item) => item.event)).toEqual(["started", "error"]);
    expect(events[1].data).toEqual({ message: "渠道暂不可用", messageId: fixture.started.worldMessage.id });
    expect(fixture.worldMessage()).toMatchObject({ status: "failed", error: "渠道暂不可用" });
    expect(fixture.completeTurn).not.toHaveBeenCalled();
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
    fixture.requestAbort.abort();
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
  });

  test.each(["truncated", "provider-error", "read-error"] as const)("%s streams fail without completing the turn", async (failure) => {
    const fixture = setup();
    const body = controlledBody();
    const reading = new Response(fixture.stream(async () => ({ stream: true, response: body.response, protocol: "responses" }))).text();
    await body.reading.promise;
    if (failure === "read-error") body.controller.error(new Error("读取中断"));
    else {
      body.controller.enqueue(encoder.encode(failure === "truncated"
        ? responseDelta(resultText)
        : 'data: {"error":{"message":"额度不足"}}\n\n'));
      if (failure === "truncated") body.controller.close();
    }
    const events = parseEvents(await reading);

    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.data.message).toBe(failure === "truncated" ? "世界回应中途断开，请重试" : failure === "provider-error" ? "额度不足" : "读取中断");
    expect(fixture.worldMessage().status).toBe("failed");
    expect(fixture.completeTurn).not.toHaveBeenCalled();
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
    expect(fixture.upstreamSignal.aborted).toBe(true);
    expect(body.response.body!.locked).toBe(false);
    expect(fixture.onComplete).not.toHaveBeenCalled();
  });

  test("completion failures are persisted as failed and emit no done event", async () => {
    const fixture = setup();
    fixture.completeTurn.mockImplementation(() => { throw new Error("落库失败"); });
    const events = parseEvents(await new Response(fixture.stream(async () => fallback())).text());

    expect(events.map((item) => item.event)).toEqual(["started", "error"]);
    expect(fixture.worldMessage()).toMatchObject({ status: "failed", error: "落库失败" });
    expect(fixture.failTurn).toHaveBeenCalledTimes(1);
    expect(fixture.onComplete).not.toHaveBeenCalled();
  });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "dou-qi-life-stream-"));
  const store = openAppDatabase({ dataDir });
  cleanups.push(() => {
    store.close();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
  });
  const state: ServerState = {
    version: 1,
    auth: { accessCodeHash: "", sessionSecret: "secret", adminUserId: "alice" },
    users: { alice: { userId: "alice", displayName: "Alice", createdAt: 1 } },
    channels: {}, assets: {}, jobs: {}, projects: {}, projectTombstones: {},
  };
  store.saveState(state);
  const service = createDouQiLifeService(store.raw!, { now: () => 1_000 });
  const session = service.createSession("alice", { name: "沈砚" });
  const action = "观察山路";
  const started = service.beginTurn("alice", session.id, action);
  const completeTurn = spyOn(service, "completeTurn");
  const failTurn = spyOn(service, "failTurn");
  const requestAbort = new AbortController();
  const onComplete = mock(() => undefined);
  let upstreamSignal!: AbortSignal;
  return {
    service, session, started, completeTurn, failTurn, requestAbort, onComplete,
    get upstreamSignal() { return upstreamSignal; },
    worldMessage: () => service.getSessionWithHistory("alice", session.id)!.messages.find((message) => message.id === started.worldMessage.id)!,
    stream: (openUpstream: (signal: AbortSignal) => Promise<DouQiLifeUpstream>) => streamDouQiLifeTurn({
      service, userId: "alice", sessionId: session.id, started, action, signal: requestAbort.signal, onComplete,
      openUpstream: (signal) => { upstreamSignal = signal; return openUpstream(signal); },
    }),
  };
}

function expectCanceled(fixture: ReturnType<typeof setup>) {
  expect(fixture.worldMessage()).toMatchObject({ status: "failed", error: "本次世界回应已取消" });
  expect(fixture.failTurn).toHaveBeenCalledTimes(1);
  expect(fixture.completeTurn).not.toHaveBeenCalled();
}

function fallback(): DouQiLifeUpstream {
  return { stream: false, response: new Response(null), protocol: "responses", text: resultText };
}

function responseDelta(delta: string) {
  return `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`;
}

function controlledBody() {
  const reading = deferred<void>();
  const canceled = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { reading.resolve(); },
    cancel() { canceled.resolve(); },
  }, { highWaterMark: 0 }));
  return { controller, response, reading, canceled };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value } = await reader.read();
  return parseEvents(new TextDecoder().decode(value))[0];
}

function parseEvents(text: string) {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const [event, data] = block.split("\n");
    return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

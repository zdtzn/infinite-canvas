import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

import { streamDouQiLifeTurn } from "./stream";

// Execute the actual route and its handlers with injected dependencies; never import index.ts.
const source = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
function functionSource(name: string) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`Missing server function: ${name}`);
  const next = source.slice(start + 1).search(/^(?:async )?function \w+[<(]/m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const handlerSource = [
  "route", "requireDouQiLife", "getDouQiLifeSave", "renameDouQiLifeSave",
  "restoreDouQiLifeSave", "deleteDouQiLifeSave", "sendDouQiLifeTurn",
  "decodeRouteSegment", "json", "chatStreamHeaders",
].map(functionSource).join("\n");
const createRoute = new Function("dependencies", `
  const {
    douQiLife, requireSession, enforceSameOrigin, enforceRateLimit, readJson, HttpError,
    defaultChatTextModel, assertPlatformModelAllowed, platformChannel, decryptChannelApiKey,
    buildDouQiLifeTurnPrompt, openDouQiLifeUpstream, streamDouQiLifeTurn,
  } = dependencies;
  const shuttingDown = false;
  const clientIp = () => "127.0.0.1";
  ${new Bun.Transpiler({ loader: "ts" }).transformSync(handlerSource)}
  return route;
`);

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

describe("dou qi life save routes", () => {
  test("GET returns the preview directly and decodes the ID for the authenticated user", async () => {
    const fixture = setup();
    const response = await fixture.route(request("GET", "save%2Did"), "test");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(fixture.preview);
    expect(fixture.service.getSavePreview).toHaveBeenCalledWith("alice", "save-id");
    expect(fixture.service.restoreSave).not.toHaveBeenCalled();
    expect(fixture.service.renameSave).not.toHaveBeenCalled();
    expect(fixture.enforceRateLimit).toHaveBeenCalledWith("alice:127.0.0.1", 240);
  });

  test("PATCH forwards only the title and returns the renamed save", async () => {
    const fixture = setup();
    const req = request("PATCH", "save-id", { title: "新的留痕", userId: "bob", state: { gold: 999 } });
    const response = await fixture.route(req, "test");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ save: { ...fixture.save, title: "新的留痕" } });
    expect(fixture.service.renameSave).toHaveBeenCalledWith("alice", "save-id", "新的留痕");
    expect(fixture.readJson).toHaveBeenCalledWith(req, 8 * 1024);
    expect(fixture.enforceSameOrigin).toHaveBeenCalledWith(req);
    expect(fixture.enforceRateLimit).toHaveBeenCalledWith("alice:127.0.0.1", 90);
    expect(fixture.service.restoreSave).not.toHaveBeenCalled();
    expect(fixture.service.deleteSave).not.toHaveBeenCalled();
  });

  test.each(["GET", "PATCH", "POST", "DELETE"])("%s rejects requests without a session", async (method) => {
    const fixture = setup();
    fixture.requireSession.mockImplementation(() => { throw new HttpError(401, "请先登录"); });

    await expect(fixture.route(request(method), "test")).rejects.toMatchObject({ status: 401 });
    for (const method of Object.values(fixture.service)) expect(method).not.toHaveBeenCalled();
  });

  test.each(["GET", "PATCH", "POST", "DELETE"])("%s preserves service ownership errors", async (method) => {
    const fixture = setup();
    const denied = () => { throw new HttpError(404, "存档不存在"); };
    fixture.service.getSavePreview.mockImplementation(denied);
    fixture.service.renameSave.mockImplementation(denied);
    fixture.service.restoreSave.mockImplementation(denied);
    fixture.service.deleteSave.mockImplementation(denied);

    await expect(fixture.route(request(method), "test")).rejects.toMatchObject({ status: 404, message: "存档不存在" });
    const called = Object.values(fixture.service).filter((item) => item.mock.calls.length);
    expect(called).toHaveLength(1);
    expect(called[0].mock.calls[0].slice(0, 2)).toEqual(["alice", "save-id"]);
  });

  test.each(["PATCH", "POST", "DELETE"])("%s preserves the origin guard", async (method) => {
    const fixture = setup();
    fixture.enforceSameOrigin.mockImplementation(() => { throw new HttpError(403, "跨站请求已拒绝"); });

    await expect(fixture.route(request(method), "test")).rejects.toMatchObject({ status: 403 });
    expect(fixture.requireSession).not.toHaveBeenCalled();
    for (const method of Object.values(fixture.service)) expect(method).not.toHaveBeenCalled();
  });

  test.each(["GET", "PATCH"])("%s rejects malformed or unsafe encoded IDs", async (method) => {
    const fixture = setup();
    for (const id of ["%ZZ", "%2F", "%5C", "%00"]) {
      await expect(fixture.route(request(method, id), "test")).rejects.toMatchObject({ status: 400, message: "存档 ID无效" });
    }
    expect(fixture.service.getSavePreview).not.toHaveBeenCalled();
    expect(fixture.service.renameSave).not.toHaveBeenCalled();
  });

  test("POST still restores a separate life with status 201", async () => {
    const fixture = setup();
    const response = await fixture.route(request("POST"), "test");

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ session: { id: "branch-id" } });
    expect(fixture.service.restoreSave).toHaveBeenCalledWith("alice", "save-id");
    expect(fixture.service.renameSave).not.toHaveBeenCalled();
    expect(fixture.service.getSavePreview).not.toHaveBeenCalled();
  });

  test("DELETE still deletes only the save and returns 204 or 404", async () => {
    const fixture = setup();
    const response = await fixture.route(request("DELETE"), "test");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(fixture.service.deleteSave).toHaveBeenCalledWith("alice", "save-id");
    fixture.service.deleteSave.mockReturnValue(false);
    await expect(fixture.route(request("DELETE"), "test")).rejects.toMatchObject({ status: 404 });
    expect(fixture.service.restoreSave).not.toHaveBeenCalled();
  });
});

test.each(["body", "request"] as const)("the turn route forwards %s cancellation while upstream headers are pending", async (kind) => {
  const fixture = setup();
  const beginTurn = mock(() => ({ session: {}, playerMessage: {}, worldMessage: { id: "world-id" } }));
  const failTurn = mock(() => undefined);
  const completeTurn = mock(() => undefined);
  let signal!: AbortSignal;
  fixture.dependencies.douQiLife = { beginTurn, failTurn, completeTurn, context: () => ({ state: {}, messages: [] }) };
  fixture.dependencies.openDouQiLifeUpstream = mock((_channel, _key, _model, _messages, upstreamSignal) => {
    signal = upstreamSignal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const route = createRoute(fixture.dependencies);
  const abort = new AbortController();
  const response = await route(new Request("http://localhost/api/dou-qi-life/sessions/life-id/turn", {
    method: "POST", body: JSON.stringify({ action: "观察山路" }), signal: abort.signal,
  }), "test");

  expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("no-cache, no-store");
  const reader = response.body!.getReader();
  await reader.read();
  if (kind === "body") await reader.cancel();
  else abort.abort();
  expect((await reader.read()).done).toBe(true);
  expect(signal.aborted).toBe(true);
  expect(failTurn).toHaveBeenCalledWith("alice", "life-id", "world-id", "本次世界回应已取消");
  expect(failTurn).toHaveBeenCalledTimes(1);
  expect(completeTurn).not.toHaveBeenCalled();
  expect(fixture.enforceRateLimit).toHaveBeenCalledWith("alice:127.0.0.1:dou-qi-life", 30);
});

function setup() {
  const save = { id: "save-id", title: "山路留痕" };
  const preview = { save, title: "沈砚的人生", state: { world: { location: "青山镇" } }, lastNarrative: "山风穿过林梢。" };
  const service = {
    getSavePreview: mock((_userId: string, _saveId: string) => preview),
    renameSave: mock((_userId: string, _saveId: string, title: unknown) => ({ ...save, title })),
    restoreSave: mock((_userId: string, _saveId: string) => ({ id: "branch-id" })),
    deleteSave: mock((_userId: string, _saveId: string) => true),
  };
  const requireSession = mock(() => ({ userId: "alice" }));
  const enforceSameOrigin = mock((_request: Request) => undefined);
  const enforceRateLimit = mock((_key: string, _limit: number) => undefined);
  const readJson = mock((request: Request, _maxBytes: number) => request.json());
  const dependencies: Record<string, unknown> = {
    douQiLife: service, requireSession, enforceSameOrigin, enforceRateLimit, readJson, HttpError,
    defaultChatTextModel: () => ({ channelId: "channel", model: "model" }),
    assertPlatformModelAllowed: () => undefined, platformChannel: () => ({}),
    decryptChannelApiKey: () => "test-key", buildDouQiLifeTurnPrompt: () => "prompt",
    openDouQiLifeUpstream: () => { throw new Error("Unexpected upstream request"); }, streamDouQiLifeTurn,
  };
  return { route: createRoute(dependencies), service, save, preview, requireSession, enforceSameOrigin, enforceRateLimit, readJson, dependencies };
}

function request(method: string, id = "save-id", body: unknown = { title: "新的留痕" }) {
  return new Request(`http://localhost/api/dou-qi-life/saves/${id}`, {
    method, ...(method === "PATCH" ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

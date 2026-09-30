import { describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

import { createDouQiLifeService } from "./service";
import { buildDouQiLifeTurnPrompt } from "./prompt";
import { streamDouQiLifeTurn, type DouQiLifeUpstream } from "./stream";

const encoder = new TextEncoder();
const index = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
function functionSource(name: string) {
  const start = index.search(new RegExp(`^(?:async )?function ${name}[<(]`, "m"));
  if (start < 0) throw new Error(`Missing server function: ${name}`);
  const next = index.slice(start + 1).search(/^(?:async )?function \w+[<(]/m);
  return index.slice(start, next < 0 ? undefined : start + 1 + next);
}
const routeSource = ["route", "sendDouQiLifeTurn", "decodeRouteSegment", "readJson", "readRequestBytes", "readStreamBytes", "chatStreamHeaders"].map(functionSource).join("\n");
const createRoute = new Function("dependencies", `
  const {
    requireDouQiLife, defaultChatTextModel, assertPlatformModelAllowed, HttpError,
    platformChannel, decryptChannelApiKey, buildDouQiLifeTurnPrompt,
    openDouQiLifeUpstream, streamDouQiLifeTurn,
    requireSession, enforceSameOrigin, enforceRateLimit, clientIp,
  } = dependencies;
  const shuttingDown = false;
  const MAX_JSON_BYTES = 8 * 1024 * 1024;
  ${new Bun.Transpiler({ loader: "ts" }).transformSync(routeSource)}
  return route;
`);

describe("dou qi life HTTP cancellation", () => {
  for (const forwardRequestAbort of [true, false]) {
    test.each(["headers", "body"] as const)(`fetch abort during upstream %s (${forwardRequestAbort ? "native request.signal" : "source cancel only"})`, async (phase) => {
      const fixture = setup(phase, forwardRequestAbort);
      const clientAbort = new AbortController();
      try {
        const response = await fetch(new URL(`/api/dou-qi-life/sessions/${fixture.session.id}/turn`, fixture.server.url), {
          method: "POST", body: JSON.stringify({ action: "观察山路" }),
          headers: { "Content-Type": "application/json" }, signal: clientAbort.signal,
        });
        const reader = response.body!.getReader();
        let output = new TextDecoder().decode((await reader.read()).value);
        expect(output).toContain("event: started");
        await fixture.upstreamStarted.promise;
        if (phase === "body") {
          while (!output.includes("event: delta")) output += new TextDecoder().decode((await reader.read()).value);
          await fixture.upstreamReading.promise;
        }
        const read = reader.read().catch((error) => error);
        clientAbort.abort();
        expect((await read).name).toBe("AbortError");

        const stopped = await Promise.race([
          fixture.upstreamAborted.promise.then(() => true),
          Bun.sleep(700).then(() => false),
        ]);
        console.info(JSON.stringify({
          event: "douqi_http_abort_probe", bun: Bun.version, phase, forwardRequestAbort,
          requestAborted: fixture.requestSignal.aborted,
          streamRequestAborted: fixture.streamSignal.aborted,
          failTurnCalls: fixture.failTurn.mock.calls.length,
          upstreamAborted: fixture.upstreamSignal.aborted,
          upstreamReaderCanceled: fixture.readerCanceled,
          status: fixture.worldMessage().status,
        }));
        expect(stopped).toBe(true);
        expect(fixture.worldMessage()).toMatchObject({ status: "failed", error: "本次世界回应已取消" });
        expect(fixture.failTurn).toHaveBeenCalledTimes(1);
        expect(fixture.completeTurn).not.toHaveBeenCalled();
        if (!forwardRequestAbort) expect(fixture.streamSignal.aborted).toBe(false);
        if (phase === "body") await fixture.upstreamCanceled.promise;
      } finally {
        clientAbort.abort();
        await fixture.close();
      }
    });
  }
});

function setup(phase: "headers" | "body", forwardRequestAbort: boolean) {
  const database = memoryDatabase();
  const service = createDouQiLifeService(database, { now: () => 1_000 });
  const session = service.createSession("alice", { name: "沈砚" });
  let started!: ReturnType<typeof service.beginTurn>;
  const beginTurn = service.beginTurn;
  service.beginTurn = (...args) => (started = beginTurn(...args));
  const failTurn = spyOn(service, "failTurn");
  const completeTurn = spyOn(service, "completeTurn");
  const upstreamStarted = deferred<void>();
  const upstreamReading = deferred<void>();
  const upstreamAborted = deferred<void>();
  const upstreamCanceled = deferred<void>();
  const headers = deferred<DouQiLifeUpstream>();
  let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
  let emitted = false;
  let readerCanceled = false;
  const upstreamResponse = new Response(new ReadableStream<Uint8Array>({
    start(controller) { upstreamController = controller; },
    pull(controller) {
      if (emitted) upstreamReading.resolve();
      else {
        emitted = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"narrative":"山风' })}\n\n`));
      }
    },
    cancel() { readerCanceled = true; upstreamCanceled.resolve(); },
  }, { highWaterMark: 0 }));
  let requestSignal!: AbortSignal;
  let streamSignal!: AbortSignal;
  let upstreamSignal!: AbortSignal;
  const route = createRoute({
    requireDouQiLife: () => service,
    requireSession: () => ({ userId: "alice" }),
    enforceSameOrigin: () => undefined, enforceRateLimit: () => undefined, clientIp: () => "127.0.0.1",
    HttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
    defaultChatTextModel: () => ({ channelId: "mock", model: "mock" }),
    assertPlatformModelAllowed: () => undefined, platformChannel: () => ({}), decryptChannelApiKey: () => "mock",
    buildDouQiLifeTurnPrompt,
    streamDouQiLifeTurn: (options: Parameters<typeof streamDouQiLifeTurn>[0]) => {
      // Observe the signal only when the production handler first passes it to the stream.
      requestSignal = options.signal;
      streamSignal = forwardRequestAbort ? options.signal : new AbortController().signal;
      return streamDouQiLifeTurn({ ...options, signal: streamSignal });
    },
    openDouQiLifeUpstream(_channel: unknown, _key: string, _model: string, _messages: unknown, signal: AbortSignal) {
      upstreamSignal = signal;
      signal.addEventListener("abort", () => {
        upstreamAborted.resolve();
        if (phase === "headers") headers.reject(signal.reason);
      }, { once: true });
      upstreamStarted.resolve();
      return phase === "headers" ? headers.promise : Promise.resolve({ stream: true, response: upstreamResponse, protocol: "responses" });
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      return route(request, "integration-test");
    },
  });
  return {
    database, service, session, server, failTurn, completeTurn,
    get started() { return started; },
    upstreamStarted, upstreamReading, upstreamAborted, upstreamCanceled,
    get requestSignal() { return requestSignal; },
    get streamSignal() { return streamSignal; },
    get upstreamSignal() { return upstreamSignal; },
    get readerCanceled() { return readerCanceled; },
    worldMessage: () => service.getSessionWithHistory("alice", session.id)!.messages.find((message) => message.id === started.worldMessage.id)!,
    async close() {
      headers.reject(new Error("test cleanup"));
      // Consume a possible unused rejection in the body case.
      void headers.promise.catch(() => undefined);
      try { upstreamController.error(new Error("test cleanup")); } catch {}
      await Bun.sleep(10);
      await server.stop(true);
      database.close();
    },
  };
}

function memoryDatabase() {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (user_id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'), ('bob');");
  // Reuse the actual dou qi table definitions without opening a disk database or the app server.
  const schema = readFileSync(new URL("../../db/database.ts", import.meta.url), "utf8");
  for (const name of ["sessions", "messages", "saves"]) {
    const statement = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS douqi_life_${name} \\([\\s\\S]*?\\n\\s*\\);`))?.[0];
    if (!statement) throw new Error(`Missing dou qi schema: ${name}`);
    database.exec(statement);
  }
  database.exec(`
    ALTER TABLE douqi_life_saves ADD COLUMN save_kind TEXT NOT NULL DEFAULT 'manual' CHECK (save_kind IN ('auto', 'manual'));
    CREATE UNIQUE INDEX idx_douqi_life_saves_auto ON douqi_life_saves(user_id, session_id) WHERE save_kind = 'auto';
  `);
  return database;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

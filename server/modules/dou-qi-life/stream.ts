import { consumeChatStream, type ChatProtocol, type ChatStreamState } from "../../lib/chat-protocol";
import { parseDouQiLifeTurnResult } from "./prompt";
import type { createDouQiLifeService } from "./service";

type DouQiLifeService = ReturnType<typeof createDouQiLifeService>;
export type DouQiLifeUpstream =
  | { stream: true; response: Response; protocol: ChatProtocol }
  | { stream: false; response: Response; protocol: ChatProtocol; text: string };

export function streamDouQiLifeTurn(options: {
  openUpstream: (signal: AbortSignal) => Promise<DouQiLifeUpstream>;
  service: Pick<DouQiLifeService, "completeTurn" | "failTurn">;
  userId: string;
  sessionId: string;
  started: ReturnType<DouQiLifeService["beginTurn"]>;
  action: string;
  signal: AbortSignal;
  onComplete?: () => void;
}) {
  const { service, userId, sessionId, started, action, signal } = options;
  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();
  let canceled = false;
  let settled = false;
  let downstream: ReadableStreamDefaultController<Uint8Array>;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let upstreamResponse: Response | null = null;

  function cancelUpstream(reason?: unknown) {
    const cancellation = upstreamReader ? upstreamReader.cancel(reason) : upstreamResponse?.body?.cancel(reason);
    void cancellation?.catch(() => undefined);
  }

  function cancel(reason?: unknown, close = true) {
    if (settled) return;
    canceled = settled = true;
    signal.removeEventListener("abort", onAbort);
    try {
      service.failTurn(userId, sessionId, started.worldMessage.id, "本次世界回应已取消");
    } finally {
      upstreamAbort.abort(reason);
      cancelUpstream(reason);
      if (close) downstream.close();
    }
  }

  function onAbort() {
    cancel(signal.reason);
  }

  function emit(event: string, payload: unknown) {
    if (!canceled) downstream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      downstream = controller;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        cancel(signal.reason);
        return;
      }
      emit("started", { session: started.session, playerMessage: started.playerMessage, worldMessage: started.worldMessage });
      void (async () => {
        try {
          const upstream = await options.openUpstream(upstreamAbort.signal);
          upstreamResponse = upstream.response;
          if (canceled) {
            cancelUpstream();
            return;
          }
          let text: string;
          let emittedNarrative = "";
          if (upstream.stream) {
            const reader = upstream.response.body!.getReader();
            upstreamReader = reader;
            const decoder = new TextDecoder();
            const state: ChatStreamState = { buffer: "", text: "", completed: false };
            const emitNarrative = () => {
              const narrative = partialJsonStringField(state.text, "narrative");
              const delta = narrative.slice(emittedNarrative.length);
              if (!delta) return;
              emittedNarrative = narrative;
              emit("delta", { messageId: started.worldMessage.id, delta });
            };
            for (;;) {
              const next = await reader.read();
              if (canceled) return;
              if (next.done) break;
              consumeChatStream(upstream.protocol, state, decoder.decode(next.value, { stream: true }), emitNarrative);
              if (state.error) throw new Error(state.error);
            }
            consumeChatStream(upstream.protocol, state, decoder.decode(), emitNarrative, true);
            if (state.error) throw new Error(state.error);
            if (!state.completed) throw new Error("世界回应中途断开，请重试");
            text = state.text;
          } else {
            text = upstream.text;
          }
          const result = parseDouQiLifeTurnResult(text);
          if (canceled) return;
          const completed = service.completeTurn(userId, sessionId, started.worldMessage.id, result, action, started.resolution);
          settled = true;
          signal.removeEventListener("abort", onAbort);
          if (!emittedNarrative) emit("delta", { messageId: started.worldMessage.id, delta: result.narrative });
          emit("done", { session: completed.session, worldMessage: completed.worldMessage, suggestions: completed.suggestions, notice: completed.notice, changes: completed.changes });
          controller.close();
          options.onComplete?.();
        } catch (error) {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          const message = error instanceof Error ? error.message : "世界回应暂未完成";
          try {
            service.failTurn(userId, sessionId, started.worldMessage.id, message);
            emit("error", { message, messageId: started.worldMessage.id });
            controller.close();
          } catch (failure) {
            controller.error(failure);
          } finally {
            upstreamAbort.abort(error);
            cancelUpstream(error);
          }
        } finally {
          upstreamReader?.releaseLock();
          upstreamReader = null;
        }
      })();
    },
    cancel(reason) {
      cancel(reason, false);
    },
  });
}

function partialJsonStringField(text: string, key: string) {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
  if (colonIndex < 0) return "";
  let start = colonIndex + 1;
  while (/\s/.test(text[start] || "")) start += 1;
  if (text[start] !== '"') return "";
  let body = "";
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      body += `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      break;
    } else {
      body += character;
    }
  }
  try { return JSON.parse(`"${body}"`) as string; } catch { return ""; }
}

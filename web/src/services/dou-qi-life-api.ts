import { friendlyErrorMessage } from "@/lib/friendly-error";
import { fetchServerResource, serverRequest } from "@/services/server-api";

export type DouQiLifeCharacterInput = {
    name?: string;
    gender?: string;
    age?: number;
    birthplace?: string;
    race?: string;
    familyBackground?: string;
    personality?: string;
    appearance?: string;
    lifeGoal?: string;
    talent?: string;
    randomize?: boolean;
};

export type DouQiLifeState = {
    player: {
        name: string;
        gender: string;
        age: number;
        birthplace: string;
        race: string;
        familyBackground: string;
        personality: string;
        appearance: string;
        lifeGoal: string;
        talent: string;
        realm: string;
        qiStage: number;
        qi: number;
        qiMax: number;
        life: number;
        lifeMax: number;
        condition: string;
        mood: string;
        cultivationMethod: string;
    };
    world: { year: number; season: string; month: number; day: number; period: string; location: string; weather: string; scene: string };
    npcs: Array<{ id: string; name: string; identity: string; realm: string; relationship: number; impression: string; history: string[] }>;
    inventory: { gold: number; items: Array<{ id: string; name: string; category: string; quantity: number; description: string }> };
    techniques: Array<{ id: string; name: string; kind: string; grade: string; attribute: string; effect: string; proficiency: number; source: string }>;
    battle: { active: boolean; enemyName: string; enemyRealm: string; enemyLife: number; enemyLifeMax: number; status: string };
    memory: { recentEvents: string[]; longTermFacts: string[]; choices: string[] };
};

export type DouQiLifeSession = { id: string; title: string; status: "active" | "ended"; state: DouQiLifeState; lastNarrative: string; createdAt: number; updatedAt: number };
export type DouQiLifeMessage = { id: string; sessionId: string; role: "player" | "world"; kind: "action" | "narrative" | "system"; content: string; metadata: { suggestions?: DouQiLifeSuggestion[]; notice?: string }; status: "streaming" | "completed" | "failed"; error: string; createdAt: number; updatedAt: number };
export type DouQiLifeSuggestion = { id: string; label: string; action: string };
export type DouQiLifeSave = { id: string; sessionId: string; title: string; createdAt: number; updatedAt: number };
export type DouQiLifeDetail = { session: DouQiLifeSession; messages: DouQiLifeMessage[] };

type DouQiTurnHandlers = {
    expectedUserId?: string;
    signal?: AbortSignal;
    onStarted?: (value: { session: DouQiLifeSession; playerMessage: DouQiLifeMessage; worldMessage: DouQiLifeMessage }) => void;
    onDelta?: (value: { messageId: string; delta: string }) => void;
    onDone?: (value: { session: DouQiLifeSession; worldMessage: DouQiLifeMessage; suggestions: DouQiLifeSuggestion[]; notice: string }) => void;
    onError?: (value: { messageId?: string; message: string }) => void;
};

export function fetchDouQiLifeSessions(expectedUserId?: string) {
    return serverRequest<{ items: DouQiLifeSession[] }>("/api/dou-qi-life/sessions", { timeoutMs: 12_000, expectedUserId });
}

export function createDouQiLifeSession(input: DouQiLifeCharacterInput, expectedUserId?: string) {
    return serverRequest<{ session: DouQiLifeSession }>("/api/dou-qi-life/sessions", { method: "POST", body: input, timeoutMs: 15_000, expectedUserId });
}

export function fetchDouQiLifeSession(id: string, expectedUserId?: string) {
    return serverRequest<DouQiLifeDetail>(`/api/dou-qi-life/sessions/${encodeURIComponent(id)}`, { timeoutMs: 15_000, expectedUserId });
}

export function deleteDouQiLifeSession(id: string, expectedUserId?: string) {
    return serverRequest(`/api/dou-qi-life/sessions/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export function fetchDouQiLifeSaves(sessionId?: string, expectedUserId?: string) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return serverRequest<{ items: DouQiLifeSave[] }>(`/api/dou-qi-life/saves${query}`, { timeoutMs: 12_000, expectedUserId });
}

export function saveDouQiLifeSession(input: { sessionId: string; title?: string }, expectedUserId?: string) {
    return serverRequest<{ save: DouQiLifeSave }>("/api/dou-qi-life/saves", { method: "POST", body: input, timeoutMs: 15_000, expectedUserId });
}

export function restoreDouQiLifeSave(id: string, expectedUserId?: string) {
    return serverRequest<{ session: DouQiLifeSession }>(`/api/dou-qi-life/saves/${encodeURIComponent(id)}`, { method: "POST", timeoutMs: 15_000, expectedUserId });
}

export function deleteDouQiLifeSave(id: string, expectedUserId?: string) {
    return serverRequest(`/api/dou-qi-life/saves/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export async function sendDouQiLifeTurn(sessionId: string, action: string, input: DouQiTurnHandlers) {
    const response = await fetchServerResource(`/api/dou-qi-life/sessions/${encodeURIComponent(sessionId)}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        signal: input.signal,
    }, input.expectedUserId);
    if (!response.ok) throw new Error(await readErrorResponse(response));
    if (!response.body) throw new Error("斗气人生没有返回可读回应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: "" };
    const lifecycle = { started: false, terminal: false };
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            consumeEvents(state, decoder.decode(next.value, { stream: true }), input, false, lifecycle);
        }
        consumeEvents(state, decoder.decode(), input, true, lifecycle);
        if (!lifecycle.started) throw new Error("斗气人生没有开始回应，请重试");
        if (!lifecycle.terminal) throw new Error("斗气人生回应中途断开，请重试");
    } finally {
        reader.releaseLock();
    }
}

function consumeEvents(state: { buffer: string }, text: string, handlers: DouQiTurnHandlers, flush: boolean, lifecycle: { started: boolean; terminal: boolean }) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeEventBlock(state.buffer.slice(0, index), handlers, lifecycle);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeEventBlock(state.buffer, handlers, lifecycle);
        state.buffer = "";
    }
}

function consumeEventBlock(block: string, handlers: DouQiTurnHandlers, lifecycle: { started: boolean; terminal: boolean }) {
    const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n").trim();
    if (!event || !data) return;
    const payload = safeJson(data) as Record<string, unknown>;
    if (event === "started") {
        lifecycle.started = true;
        handlers.onStarted?.(payload as never);
    } else if (event === "delta") {
        handlers.onDelta?.({ messageId: String(payload.messageId || ""), delta: String(payload.delta || "") });
    } else if (event === "done") {
        lifecycle.terminal = true;
        handlers.onDone?.(payload as never);
    } else if (event === "error") {
        lifecycle.terminal = true;
        handlers.onError?.({ messageId: String(payload.messageId || ""), message: String(payload.message || "世界暂未回应") });
    }
}

async function readErrorResponse(response: Response) {
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
    return friendlyErrorMessage(typeof error.message === "string" ? error.message : "斗气人生暂未回应", response.status);
}

function safeJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return {}; }
}

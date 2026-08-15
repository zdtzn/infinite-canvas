import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import { DOU_QI_MOODS, DOU_QI_PERIODS, DOU_QI_REALMS, DOU_QI_SEASONS, type DouQiBattleState, type DouQiLifeCharacterInput, type DouQiLifeMessage, type DouQiLifeSave, type DouQiLifeSession, type DouQiLifeState, type DouQiLifeTurnResult, type DouQiNpcState, type DouQiTechnique, type DouQiWorldEvent, type DouQiWorldEventStatus, type DouQiWorldEventType, type DouQiWorldState } from "./types";

const MAX_SESSIONS_PER_USER = 20;
const MAX_SAVES_PER_USER = 50;
const MAX_MESSAGES_PER_SESSION = 400;
const MAX_INVENTORY_ITEMS = 48;
const MAX_TECHNIQUES = 32;
const MAX_ACTION_CHARACTERS = 4_000;
const MAX_TEXT_CHARACTERS = 240;
const MAX_WORLD_EVENTS = 24;
const MAX_LONG_TERM_FACTS = 24;
const MAX_UNRESOLVED_GOALS = 8;
const MAX_STORY_SUMMARY_CHARACTERS = 1_200;
const MAX_TURN_HOURS = 8_760;
const MAX_OFFLINE_HOURS = 24 * 30 * 3;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DEFAULT_LOCATION = "加玛帝国 · 青山镇外围";

export class DouQiLifeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "DOU_QI_LIFE_INVALID") {
    super(message);
    this.name = "DouQiLifeError";
  }
}

export type DouQiTurnResolution = {
  state: DouQiLifeState;
  notice: string;
};

export function createDouQiLifeService(database: Database, options: { now?: () => number } = {}) {
  const now = options.now || Date.now;

  database
    .query("UPDATE douqi_life_messages SET status = 'failed', error = ?, updated_at = ? WHERE status = 'streaming'")
    .run("服务重启，本次世界回应已中断", now());

  function listSessions(userId: string) {
    const rows = database.query("SELECT * FROM douqi_life_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, MAX_SESSIONS_PER_USER) as DouQiSessionRow[];
    return rows.map(sessionFromRow).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function createSession(userId: string, input: unknown = {}) {
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_sessions WHERE user_id = ?").get(userId) as { count: number }).count);
    if (count >= MAX_SESSIONS_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请删除不再继续的人生", 409, "SESSION_LIMIT");
    const character = normalizeCharacter(input);
    const timestamp = now();
    const state = createInitialState(character, timestamp);
    ensureMemoryState(state);
    const opening = openingNarrative(state);
    const openingSuggestions = openingActionSuggestions();
    const session: DouQiLifeSession = {
      id: randomUUID(),
      title: `${character.name} 的斗气人生`,
      status: "active",
      state,
      lastNarrative: opening,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.query("INSERT INTO douqi_life_sessions(user_id, session_id, title, status, state_json, last_narrative, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, session.id, session.title, session.status, JSON.stringify(state), opening, timestamp, timestamp);
    database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, 'world', 'narrative', ?, ?, 'completed', '', ?, ?)").run(userId, randomUUID(), session.id, opening, JSON.stringify({ suggestions: openingSuggestions }), timestamp, timestamp);
    upsertAutoSave(userId, session.id, session.title, state, opening, timestamp);
    return session;
  }

  function getSession(userId: string, sessionId: string) {
    const row = database.query("SELECT * FROM douqi_life_sessions WHERE user_id = ? AND session_id = ?").get(userId, validId(sessionId, "人生 ID")) as DouQiSessionRow | null;
    return row ? materializeOfflineProgress(userId, sessionFromRow(row)) : null;
  }

  function getSessionWithHistory(userId: string, sessionId: string) {
    const session = getSession(userId, sessionId);
    if (!session) return null;
    const messages = (database.query("SELECT * FROM douqi_life_messages WHERE user_id = ? AND session_id = ? ORDER BY rowid ASC LIMIT ?").all(userId, session.id, MAX_MESSAGES_PER_SESSION) as DouQiMessageRow[]).map(messageFromRow);
    return { session, messages };
  }

  function beginTurn(userId: string, sessionId: string, action: unknown) {
    const session = requireSession(userId, sessionId);
    if (session.status !== "active" || isTerminalState(session.state)) throw new DouQiLifeError("这段人生已经结束，请读取其他存档继续", 409, "SESSION_ENDED");
    const pending = database
      .query("SELECT 1 FROM douqi_life_messages WHERE user_id = ? AND session_id = ? AND role = 'world' AND status = 'streaming' LIMIT 1")
      .get(userId, session.id);
    if (pending) throw new DouQiLifeError("上一段世界回应尚未完成，请稍候", 409, "TURN_IN_PROGRESS");
    const content = requiredText(action, MAX_ACTION_CHARACTERS, "行动");
    if (session.state.player.life <= 0 && !isRecoveryAction(content)) throw new DouQiLifeError("你已重伤昏迷，只能尝试休养、疗伤或读取其他存档", 409, "PLAYER_INCAPACITATED");
    const timestamp = now();
    const playerMessage: DouQiLifeMessage = {
      id: randomUUID(), sessionId: session.id, role: "player", kind: "action", content, metadata: {}, status: "completed", error: "", createdAt: timestamp, updatedAt: timestamp,
    };
    const worldMessage: DouQiLifeMessage = {
      id: randomUUID(), sessionId: session.id, role: "world", kind: "narrative", content: "", metadata: {}, status: "streaming", error: "", createdAt: timestamp + 1, updatedAt: timestamp + 1,
    };
    const resolution = resolveDeterministicTurn(session.state, content, timestamp);
    database.transaction(() => {
      database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(userId, playerMessage.id, session.id, playerMessage.role, playerMessage.kind, playerMessage.content, "{}", playerMessage.status, "", playerMessage.createdAt, playerMessage.updatedAt);
      database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(userId, worldMessage.id, session.id, worldMessage.role, worldMessage.kind, "", "{}", worldMessage.status, "", worldMessage.createdAt, worldMessage.updatedAt);
      database.query("UPDATE douqi_life_sessions SET updated_at = ? WHERE user_id = ? AND session_id = ?").run(timestamp, userId, session.id);
    })();
    return { session: { ...session, updatedAt: timestamp }, playerMessage, worldMessage, recentMessages: thisContextMessages(userId, session.id), resolution };
  }

  function completeTurn(userId: string, sessionId: string, worldMessageId: string, result: DouQiLifeTurnResult, action: string, resolution?: DouQiTurnResolution) {
    const session = requireSession(userId, sessionId);
    const message = getMessage(userId, worldMessageId, session.id);
    if (!message || message.role !== "world" || message.status !== "streaming") throw new DouQiLifeError("世界回应不存在或已经处理", 404, "MESSAGE_NOT_FOUND");
    const timestamp = now();
    const applied = resolution
      ? finalizeDeterministicTurn(resolution, timestamp)
      : applyTurnState(session.state, action, result.statePatch, result.narrative, timestamp);
    const state = applied.state;
    const notice = [applied.notice, result.notice].filter(Boolean).join(" ");
    const changes = describeStateChanges(session.state, state);
    const status = isTerminalState(state) ? "ended" : session.status;
    const metadata = { suggestions: result.suggestions, notice, changes };
    database.transaction(() => {
      database.query("UPDATE douqi_life_messages SET content = ?, metadata_json = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND session_id = ?").run(result.narrative.slice(0, 20_000), JSON.stringify(metadata), timestamp, userId, message.id, session.id);
      database.query("UPDATE douqi_life_sessions SET state_json = ?, last_narrative = ?, status = ?, updated_at = ? WHERE user_id = ? AND session_id = ?").run(JSON.stringify(state), result.narrative.slice(0, 20_000), status, timestamp, userId, session.id);
      upsertAutoSave(userId, session.id, session.title, state, result.narrative.slice(0, 20_000), timestamp);
      trimMessages(userId, session.id);
    })();
    return { session: { ...session, state, status: status as DouQiLifeSession["status"], lastNarrative: result.narrative.slice(0, 20_000), updatedAt: timestamp }, worldMessage: { ...message, content: result.narrative.slice(0, 20_000), metadata, status: "completed" as const, updatedAt: timestamp }, suggestions: result.suggestions, notice, changes };
  }

  function failTurn(userId: string, sessionId: string, worldMessageId: string, error: string) {
    const session = requireSession(userId, sessionId);
    const message = getMessage(userId, worldMessageId, session.id);
    if (!message) return null;
    const timestamp = now();
    database.query("UPDATE douqi_life_messages SET status = 'failed', error = ?, updated_at = ? WHERE user_id = ? AND message_id = ? AND session_id = ?").run(error.slice(0, 500), timestamp, userId, message.id, session.id);
    return { ...message, status: "failed" as const, error: error.slice(0, 500), updatedAt: timestamp };
  }

  function saveSession(userId: string, sessionId: string, title: unknown) {
    return createSave(userId, sessionId, title, "manual");
  }

  function createSave(userId: string, sessionId: string, title: unknown, kind: "auto" | "manual") {
    const detail = getSessionWithHistory(userId, sessionId);
    if (!detail) throw new DouQiLifeError("人生不存在", 404, "SESSION_NOT_FOUND");
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_saves WHERE user_id = ? AND save_kind = 'manual'").get(userId) as { count: number }).count);
    if (count >= MAX_SAVES_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请删除旧存档", 409, "SAVE_LIMIT");
    const timestamp = now();
    const save: DouQiLifeSave = { id: randomUUID(), sessionId: detail.session.id, title: optionalText(title, 80) || detail.session.title, kind, createdAt: timestamp, updatedAt: timestamp };
    const snapshot = { title: detail.session.title, state: detail.session.state, lastNarrative: detail.session.lastNarrative, messages: detail.messages.slice(-120) };
    database.query("INSERT INTO douqi_life_saves(user_id, save_id, session_id, title, snapshot_json, save_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, save.id, save.sessionId, save.title, JSON.stringify(snapshot), save.kind, timestamp, timestamp);
    return save;
  }

  function listSaves(userId: string, sessionId?: string) {
    const rows = sessionId ? database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? AND session_id = ? ORDER BY CASE WHEN save_kind = 'manual' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?").all(userId, validId(sessionId, "人生 ID"), MAX_SAVES_PER_USER + 1) : database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? ORDER BY CASE WHEN save_kind = 'manual' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?").all(userId, MAX_SAVES_PER_USER + 1);
    return (rows as DouQiSaveRow[]).map(saveFromRow);
  }

  function restoreSave(userId: string, saveId: string) {
    const row = database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? AND save_id = ?").get(userId, validId(saveId, "存档 ID")) as DouQiSaveRow | null;
    if (!row) throw new DouQiLifeError("存档不存在", 404, "SAVE_NOT_FOUND");
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_sessions WHERE user_id = ?").get(userId) as { count: number }).count);
    if (count >= MAX_SESSIONS_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请先删除不再继续的人生", 409, "SESSION_LIMIT");
    const timestamp = now();
    const snapshot = parseSnapshot(row.snapshot_json);
    snapshot.state.world.lastRealTimeAt = timestamp;
    const session: DouQiLifeSession = { id: randomUUID(), title: `${snapshot.title} · 支线`, status: isTerminalState(snapshot.state) ? "ended" : "active", state: snapshot.state, lastNarrative: snapshot.lastNarrative, createdAt: timestamp, updatedAt: timestamp };
    database.transaction(() => {
      database.query("INSERT INTO douqi_life_sessions(user_id, session_id, title, status, state_json, last_narrative, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, session.id, session.title, session.status, JSON.stringify(session.state), session.lastNarrative, timestamp, timestamp);
      const insert = database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const source of snapshot.messages) insert.run(userId, randomUUID(), session.id, source.role, source.kind, source.content, JSON.stringify(source.metadata || {}), "completed", "", source.createdAt, source.updatedAt);
    })();
    upsertAutoSave(userId, session.id, session.title, session.state, session.lastNarrative, timestamp);
    return session;
  }

  function deleteSave(userId: string, saveId: string) {
    const result = database.query("DELETE FROM douqi_life_saves WHERE user_id = ? AND save_id = ?").run(userId, validId(saveId, "存档 ID"));
    return Number(result.changes) > 0;
  }

  function deleteSession(userId: string, sessionId: string) {
    const result = database.query("DELETE FROM douqi_life_sessions WHERE user_id = ? AND session_id = ?").run(userId, validId(sessionId, "人生 ID"));
    return Number(result.changes) > 0;
  }

  function context(userId: string, sessionId: string) {
    const session = requireSession(userId, sessionId);
    return { state: session.state, messages: thisContextMessages(userId, session.id) };
  }

  function upsertAutoSave(userId: string, sessionId: string, title: string, state: DouQiLifeState, lastNarrative: string, timestamp: number) {
    const messages = thisContextMessages(userId, sessionId).slice(-120);
    const snapshot = JSON.stringify({ title, state, lastNarrative, messages });
    database.query(`
      INSERT INTO douqi_life_saves(user_id, save_id, session_id, title, snapshot_json, save_kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)
      ON CONFLICT(user_id, session_id) WHERE save_kind = 'auto'
      DO UPDATE SET title = excluded.title, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
    `).run(userId, randomUUID(), sessionId, "自动留痕 · " + title, snapshot, timestamp, timestamp);
  }

  function thisContextMessages(userId: string, sessionId: string) {
    return (database.query("SELECT * FROM douqi_life_messages WHERE user_id = ? AND session_id = ? ORDER BY rowid DESC LIMIT 16").all(userId, sessionId) as DouQiMessageRow[]).reverse().map(messageFromRow);
  }

  function getMessage(userId: string, messageId: string, sessionId: string) {
    const row = database.query("SELECT * FROM douqi_life_messages WHERE user_id = ? AND message_id = ? AND session_id = ?").get(userId, validId(messageId, "回应 ID"), sessionId) as DouQiMessageRow | null;
    return row ? messageFromRow(row) : null;
  }

  function trimMessages(userId: string, sessionId: string) {
    database.query("DELETE FROM douqi_life_messages WHERE user_id = ? AND session_id = ? AND rowid NOT IN (SELECT rowid FROM douqi_life_messages WHERE user_id = ? AND session_id = ? ORDER BY rowid DESC LIMIT ?)").run(userId, sessionId, userId, sessionId, MAX_MESSAGES_PER_SESSION);
  }

  function requireSession(userId: string, sessionId: string) {
    const session = getSession(userId, sessionId);
    if (!session) throw new DouQiLifeError("人生不存在", 404, "SESSION_NOT_FOUND");
    return session;
  }

  function materializeOfflineProgress(userId: string, session: DouQiLifeSession) {
    const pending = database
      .query("SELECT 1 FROM douqi_life_messages WHERE user_id = ? AND session_id = ? AND role = 'world' AND status = 'streaming' LIMIT 1")
      .get(userId, session.id);
    if (pending) return session;

    const savedAt = Number(session.state.world.lastRealTimeAt);
    const lastRealTimeAt = Number.isFinite(savedAt) && savedAt > 0 ? savedAt : session.updatedAt;
    const timestamp = now();
    if (!lastRealTimeAt || timestamp <= lastRealTimeAt || session.status !== "active") return session;
    const hours = Math.min(MAX_OFFLINE_HOURS, Math.floor((timestamp - lastRealTimeAt) / 3_600_000));
    if (hours < 1) return session;

    const next = cloneState(session.state);
    const beforeWorldDay = worldDay(next.world);
    advanceWorldTime(next.world, hours);
    advancePlayerAge(next.player, Math.max(0, worldDay(next.world) - beforeWorldDay));
    appendTimeDrivenEvents(next, beforeWorldDay, worldDay(next.world));
    const ended = next.player.age >= next.player.lifespan;
    if (ended) next.player.condition = "寿元已尽";
    next.world.lastRealTimeAt = timestamp;
    const newEvents = next.memory.worldEvents.length > session.state.memory.worldEvents.length;
    const narrative = `【时间】\n离开期间 · ${hours} 小时\n\n天地并未因你的离去而停滞。${newEvents ? "新的世事已在暗中发芽。" : "你归来时，风貌已有细微变化。"}`;
    next.memory.recentEvents = [narrative.slice(0, 300), ...next.memory.recentEvents].slice(0, 12);
    refreshMemorySummary(next, session.state);
    const messageId = randomUUID();

    const applied = database.transaction(() => {
      const update = database.query("UPDATE douqi_life_sessions SET state_json = ?, last_narrative = ?, status = ?, updated_at = ? WHERE user_id = ? AND session_id = ? AND updated_at = ?").run(JSON.stringify(next), narrative, ended ? "ended" : session.status, timestamp, userId, session.id, session.updatedAt);
      if (Number(update.changes) !== 1) return false;
      database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, 'world', 'system', ?, ?, 'completed', '', ?, ?)").run(userId, messageId, session.id, narrative, JSON.stringify({ offlineHours: hours }), timestamp, timestamp);
      trimMessages(userId, session.id);
      upsertAutoSave(userId, session.id, session.title, next, narrative, timestamp);
      return true;
    })();

    if (!applied) {
      const current = database.query("SELECT * FROM douqi_life_sessions WHERE user_id = ? AND session_id = ?").get(userId, session.id) as DouQiSessionRow | null;
      return current ? sessionFromRow(current) : session;
    }

    return { ...session, state: next, status: ended ? "ended" : session.status, lastNarrative: narrative, updatedAt: timestamp };
  }

  return { listSessions, createSession, getSession, getSessionWithHistory, beginTurn, completeTurn, failTurn, saveSession, listSaves, restoreSave, deleteSave, deleteSession, context };
}

type DouQiSessionRow = { session_id: string; title: string; status: string; state_json: string; last_narrative: string; created_at: number; updated_at: number };
type DouQiMessageRow = { message_id: string; session_id: string; role: string; kind: string; content: string; metadata_json: string; status: string; error: string; created_at: number; updated_at: number };
type DouQiSaveRow = { save_id: string; session_id: string; title: string; snapshot_json: string; save_kind?: string; created_at: number; updated_at: number };

function sessionFromRow(row: DouQiSessionRow): DouQiLifeSession {
  const state = parseState(row.state_json);
  return { id: row.session_id, title: row.title, status: row.status === "ended" || isTerminalState(state) ? "ended" : "active", state, lastNarrative: row.last_narrative || "", createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function messageFromRow(row: DouQiMessageRow): DouQiLifeMessage {
  return { id: row.message_id, sessionId: row.session_id, role: row.role === "world" ? "world" : "player", kind: row.kind === "narrative" ? "narrative" : row.kind === "system" ? "system" : "action", content: row.content, metadata: parseRecord(row.metadata_json), status: row.status === "streaming" ? "streaming" : row.status === "failed" ? "failed" : "completed", error: row.error || "", createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function saveFromRow(row: DouQiSaveRow): DouQiLifeSave {
  return { id: row.save_id, sessionId: row.session_id, title: row.title, kind: row.save_kind === "auto" ? "auto" : "manual", createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function normalizeCharacter(input: unknown) {
  const source = input && typeof input === "object" ? (input as DouQiLifeCharacterInput) : {};
  const randomize = source.randomize === true;
  const random = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
  const name = optionalText(source.name, 32) || (randomize ? random(["沈砚", "顾长风", "叶清禾", "萧远"] as const) : "无名道友");
  const gender = optionalText(source.gender, 20) || (randomize ? random(["男", "女", "不愿说明"] as const) : "不愿说明");
  const age = normalizeAge(source.age, randomize ? Math.floor(Math.random() * 16) + 14 : 18);
  return { name, gender, age, birthplace: optionalText(source.birthplace, MAX_TEXT_CHARACTERS) || (randomize ? random(["青山镇", "乌坦城外", "漠城边缘", "黑角域小镇"] as const) : DEFAULT_LOCATION), race: optionalText(source.race, MAX_TEXT_CHARACTERS) || "人族", familyBackground: optionalText(source.familyBackground, MAX_TEXT_CHARACTERS) || "普通小户，家中以谋生为主", personality: optionalText(source.personality, MAX_TEXT_CHARACTERS) || "谨慎而有好奇心", appearance: optionalText(source.appearance, MAX_TEXT_CHARACTERS) || "衣着朴素，眉眼清醒", lifeGoal: optionalText(source.lifeGoal, MAX_TEXT_CHARACTERS) || "先看清这片天地，再决定要走多远", talent: optionalText(source.talent, MAX_TEXT_CHARACTERS) || "尚未觉醒" };
}

function createInitialState(character: ReturnType<typeof normalizeCharacter>, timestamp = Date.now()): DouQiLifeState {
  return { player: { ...character, livedDays: character.age * 360, lifespan: defaultLifespan(character.race), realm: "斗之气", qiStage: 1, qi: 10, qiMax: 100, life: 100, lifeMax: 100, condition: "正常", mood: "平静", cultivationMethod: "无" }, world: { year: 1, season: "春季", month: 1, day: 1, hour: 6, period: "清晨", location: character.birthplace || DEFAULT_LOCATION, weather: "薄云，风息平和", scene: "一切尚未定形。", lastRealTimeAt: timestamp }, npcs: [], inventory: { gold: 20, items: [] }, techniques: [], battle: emptyBattle(), memory: { recentEvents: [], longTermFacts: [`${character.name} 来自 ${character.birthplace || DEFAULT_LOCATION}。`], choices: [], worldEvents: [] } };
}

function resolveDeterministicTurn(state: DouQiLifeState, action: string, timestamp: number): DouQiTurnResolution | undefined {
  const deterministic = state.battle.active || isCultivationAction(action) || /突破|晋阶|进阶/.test(action) || (state.player.life <= 0 && isRecoveryAction(action));
  if (!deterministic) return undefined;
  const applied = applyTurnState(state, action, undefined, "", timestamp);
  return { state: applied.state, notice: applied.notice || "" };
}

function finalizeDeterministicTurn(resolution: DouQiTurnResolution, timestamp: number) {
  const state = cloneState(resolution.state);
  state.world.lastRealTimeAt = timestamp;
  return { state, notice: resolution.notice };
}

function isRecoveryAction(action: string) {
  return /休养|疗伤|救治|恢复|服用丹药/.test(action);
}

function defaultLifespan(race: string) {
  return /兽|灵|妖/.test(race) ? 120 : 100;
}

function advancePlayerAge(player: DouQiLifeState["player"], elapsedDays: number) {
  player.livedDays = Math.max(player.age * 360, Math.trunc(player.livedDays || player.age * 360) + Math.max(0, elapsedDays));
  player.age = Math.max(1, Math.floor(player.livedDays / 360));
}

function applyItemRemovals(state: DouQiLifeState, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const entry of value.slice(0, 8)) {
    const source = record(entry);
    const name = boundedString(source?.name, "", 80);
    const id = boundedString(source?.id, "", 128);
    const quantity = clampInt(source?.quantity, 1, 999);
    const item = state.inventory.items.find((candidate) => (id && candidate.id === id) || (name && candidate.name === name));
    if (!item) continue;
    item.quantity = Math.max(0, item.quantity - quantity);
  }
  state.inventory.items = state.inventory.items.filter((item) => item.quantity > 0);
}

function rememberLongTermFacts(state: DouQiLifeState, action: string, event: string, breakthroughNotice?: string, ended = false) {
  const facts = [
    event ? `发生过事件：${event}` : "",
    breakthroughNotice && /进入|突破|晋阶|寿元/.test(breakthroughNotice) ? breakthroughNotice : "",
    /突破|晋阶|进阶|加入|拜师|立誓|承诺/.test(action) ? `重要选择：${action.slice(0, 180)}` : "",
    ended ? "这段人生已经走到终点。" : "",
  ].filter(Boolean);
  if (!facts.length) return;
  state.memory.longTermFacts = [...facts, ...state.memory.longTermFacts].filter((fact, index, all) => all.indexOf(fact) === index).slice(0, MAX_LONG_TERM_FACTS);
}

function recordMemoryTurn(state: DouQiLifeState, previousState: DouQiLifeState) {
  state.memory.turnCount = Math.max(0, Math.trunc(Number(state.memory.turnCount) || 0)) + 1;
  refreshMemorySummary(state, previousState);
}

function refreshMemorySummary(state: DouQiLifeState, previousState?: DouQiLifeState) {
  if (previousState) rememberNpcChanges(state, previousState);
  state.memory.unresolvedGoals = deriveUnresolvedGoals(state);
  state.memory.storySummary = buildStorySummary(state);
}

function rememberNpcChanges(state: DouQiLifeState, previousState: DouQiLifeState) {
  const facts = state.npcs.flatMap((npc) => {
    const previous = previousState.npcs.find((candidate) => candidate.id === npc.id || candidate.name === npc.name);
    if (!previous) return [`初次结识 ${npc.name}：${npc.identity}`];
    if (previous.relationship === npc.relationship) return [];
    const direction = npc.relationship > previous.relationship ? "提升" : "下降";
    return [`与 ${npc.name} 的关系${direction}至 ${npc.relationship}：${npc.impression}`];
  });
  if (!facts.length) return;
  state.memory.longTermFacts = [...facts, ...state.memory.longTermFacts]
    .filter((fact, index, all) => all.indexOf(fact) === index)
    .slice(0, MAX_LONG_TERM_FACTS);
}

function deriveUnresolvedGoals(state: DouQiLifeState) {
  if (isTerminalState(state)) return [];
  const eventGoals = state.memory.worldEvents
    .filter((event) => event.known && ["open", "investigating", "participating"].includes(event.status))
    .map((event) => `处理：${event.title}`);
  return [...new Set([...eventGoals, state.player.lifeGoal].filter((goal) => typeof goal === "string" && goal.trim()))]
    .slice(0, MAX_UNRESOLVED_GOALS);
}

function buildStorySummary(state: DouQiLifeState) {
  const memory = state.memory;
  const keyFacts = memory.longTermFacts.slice(0, 8);
  const recentEvents = memory.recentEvents.slice(0, 4);
  const keyNpcs = state.npcs
    .filter((npc) => npc.relationship !== 0 || npc.history.length > 0)
    .slice(0, 4)
    .map((npc) => `${npc.name}（关系 ${npc.relationship}）：${npc.impression}`);
  const lines = [
    `${state.player.name}目前处于${state.player.realm}${state.player.qiStage}段，${state.player.age}岁，位于${state.world.location}。`,
    keyFacts.length ? `关键经历：${keyFacts.join("；")}` : "",
    keyNpcs.length ? `关键人物：${keyNpcs.join("；")}` : "",
    recentEvents.length ? `最近发生：${recentEvents.join("；")}` : "",
    state.memory.unresolvedGoals?.length ? `未完成目标：${state.memory.unresolvedGoals.join("；")}` : "",
    isTerminalState(state) ? "这段人生已经走到终点。" : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, MAX_STORY_SUMMARY_CHARACTERS);
}

function isTerminalState(state: DouQiLifeState) {
  return state.player.condition === "寿元已尽";
}

function describeStateChanges(before: DouQiLifeState, after: DouQiLifeState) {
  const changes: string[] = [];
  const delta = (value: number, label: string) => {
    if (value) changes.push(`${label} ${value > 0 ? "+" : ""}${value}`);
  };
  delta(after.player.qi - before.player.qi, "斗气");
  delta(after.player.life - before.player.life, "生命");
  delta(after.inventory.gold - before.inventory.gold, "灵石");
  if (after.player.realm !== before.player.realm || after.player.qiStage !== before.player.qiStage) changes.push(`境界 ${after.player.realm} ${after.player.qiStage}段`);
  if (after.player.age !== before.player.age) changes.push(`年龄 ${after.player.age}岁`);
  if (after.world.location !== before.world.location) changes.push(`抵达 ${after.world.location}`);
  if (!before.battle.active && after.battle.active) changes.push(`遭遇 ${after.battle.enemyName}`);
  if (before.battle.active && !after.battle.active) changes.push("战斗结束");
  return changes.slice(0, 8);
}

function applyTurnState(state: DouQiLifeState, action: string, patch: unknown, narrative: string, timestamp = Date.now()): { state: DouQiLifeState; notice?: string; ended?: boolean } {
  const source = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const next = cloneState(state);
  next.world.lastRealTimeAt = timestamp;
  if (next.player.life <= 0 && isRecoveryAction(action)) {
    advanceWorldTime(next.world, 24);
    advancePlayerAge(next.player, 1);
    next.player.life = Math.min(next.player.lifeMax, 25);
    next.player.condition = "恢复中";
    next.player.mood = "平静";
    next.memory.choices = [action.slice(0, 500), ...next.memory.choices].slice(0, 20);
    next.memory.recentEvents = [action.slice(0, 300), ...next.memory.recentEvents].slice(0, 12);
    recordMemoryTurn(next, state);
    return { state: next, notice: "你暂时脱离险境，仍需继续休养。" };
  }
  const priorBattle = next.battle.active;
  const cultivation = isCultivationAction(action);
  const cultivationDuration = cultivationHours(action);
  const hours = cultivation
    ? cultivationDuration || 0
    : clampInt(source.advanceTimeHours, 0, MAX_TURN_HOURS) || impliedHours(action);
  const beforeWorldDay = worldDay(next.world);
  advanceWorldTime(next.world, hours);
  advancePlayerAge(next.player, Math.max(0, worldDay(next.world) - beforeWorldDay));
  appendTimeDrivenEvents(next, beforeWorldDay, worldDay(next.world));
  const world = record(source.world);
  if (world) {
    next.world.location = boundedString(world.location, next.world.location, 120);
    next.world.weather = boundedString(world.weather, next.world.weather, 120);
    next.world.scene = boundedString(world.scene, next.world.scene, 1_000);
  }
  const player = record(source.player);
  if (player && !priorBattle && !cultivation) {
    next.player.qi = clamp(next.player.qi + clampInt(player.qiDelta, -40, 60), 0, next.player.qiMax);
    next.player.life = clamp(next.player.life + clampInt(player.lifeDelta, -40, 40), 0, next.player.lifeMax);
    if (typeof player.mood === "string" && DOU_QI_MOODS.includes(player.mood as never)) next.player.mood = player.mood as typeof next.player.mood;
    next.player.condition = boundedString(player.condition, next.player.condition, 120);
  }
  const breakthroughNotice = !priorBattle && !cultivation
    ? tryBreakthrough(next, action)
    : undefined;
  next.inventory.gold = clamp(next.inventory.gold + clampInt(source.goldDelta, -100, 1_000), 0, 1_000_000);
  const addItems = Array.isArray(source.addItems) ? source.addItems : [];
  for (const value of addItems.slice(0, 5)) {
    const item = record(value);
    const name = boundedString(item?.name, "未知物品", 80);
    const existing = next.inventory.items.find((candidate) => candidate.name === name);
    if (existing) existing.quantity = clamp(existing.quantity + clampInt(item?.quantity, 1, 10), 1, 999);
    else if (next.inventory.items.length < MAX_INVENTORY_ITEMS) next.inventory.items.push({ id: randomUUID(), name, category: boundedString(item?.category, "材料", 40), quantity: clampInt(item?.quantity, 1, 10), description: boundedString(item?.description, "尚待确认用途", 180) });
  }
  applyItemRemovals(next, source.removeItems);
  for (const value of (Array.isArray(source.addTechniques) ? source.addTechniques : []).slice(0, 3)) {
    const technique = record(value);
    const name = boundedString(technique?.name, "未名功法", 80);
    if (next.techniques.some((item) => item.name === name)) continue;
    if (next.techniques.length < MAX_TECHNIQUES) next.techniques.push({ id: randomUUID(), name, kind: technique?.kind === "斗技" ? "斗技" : "功法", grade: boundedString(technique?.grade, "黄阶", 20), attribute: boundedString(technique?.attribute, "未明", 40), effect: boundedString(technique?.effect, "尚未完全掌握", 200), proficiency: clampInt(technique?.proficiency, 0, 100), source: boundedString(technique?.source, "未知", 120) });
  }
  applyNpcUpdates(next, source.npcUpdates);
  const event = boundedString(source.event, "", 300);
  if (event) next.memory.recentEvents = [event, ...next.memory.recentEvents].slice(0, 12);
  next.memory.choices = [action.slice(0, 500), ...next.memory.choices].slice(0, 20);
  applyWorldEvent(next, source.worldEvent);
  if (narrative.trim()) next.memory.recentEvents = [narrative.trim().slice(0, 300), ...next.memory.recentEvents].slice(0, 12);
  applyBattlePatch(next, source.battle, priorBattle);
  let notice: string | undefined = breakthroughNotice;
  if (cultivationDuration) notice = applyCultivation(next, cultivationDuration);
  else if (cultivation) notice = "闭关需要先定下时长：一个月、三个月或半年。";
  if (priorBattle) notice = resolveBattleAction(next, action) || notice;
  if (next.player.life <= 0) {
    next.battle = emptyBattle();
    next.player.condition = "重伤昏迷";
    notice = "你已重伤昏迷，只能接受救治或读取其他存档。";
  }
  const ended = next.player.age >= next.player.lifespan;
  if (ended) {
    next.player.condition = "寿元已尽";
    notice = "寿元走到尽头，这段人生至此落幕。";
  }
  rememberLongTermFacts(next, action, event, breakthroughNotice, ended);
  recordMemoryTurn(next, state);
  return { state: next, notice, ended };
}

function applyNpcUpdates(state: DouQiLifeState, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const entry of value.slice(0, 4)) {
    const source = record(entry);
    const name = boundedString(source?.name, "", 80);
    if (!name) continue;
    const id = boundedString(source?.id, `npc-${name}`, 80);
    const existing = state.npcs.find((npc) => npc.id === id || npc.name === name);
    if (existing) {
      existing.identity = boundedString(source?.identity, existing.identity, 80);
      existing.realm = boundedString(source?.realm, existing.realm, 40);
      existing.faction = boundedString(source?.faction, existing.faction, 80);
      existing.personality = boundedString(source?.personality, existing.personality, 160);
      existing.goal = boundedString(source?.goal, existing.goal, 160);
      existing.relationship = clamp(existing.relationship + clampInt(source?.relationshipDelta, -10, 10), -100, 100);
      existing.impression = boundedString(source?.impression, existing.impression, 300);
      const history = boundedString(source?.history, "", 300);
      if (history) existing.history = [history, ...existing.history].slice(0, 12);
      if (typeof source?.secret === "string" && source.secret.trim()) existing.secret = boundedString(source.secret, existing.secret, 300);
      existing.lastSeenAt = `${state.world.year}年${state.world.month}月${state.world.day}日`;
    } else state.npcs.push({ id, name, identity: boundedString(source?.identity, "过客", 80), realm: boundedString(source?.realm, "斗之气", 40), faction: boundedString(source?.faction, "无", 80), personality: boundedString(source?.personality, "尚未看清", 160), goal: boundedString(source?.goal, "未知", 160), relationship: clamp(clampInt(source?.relationship, 0, 10), -100, 100), impression: boundedString(source?.impression, "初见", 300), history: [], secret: boundedString(source?.secret, "", 300), lastSeenAt: `${state.world.year}年${state.world.month}月${state.world.day}日` });
  }
  state.npcs = state.npcs.slice(0, 24);
}

function applyBattlePatch(state: DouQiLifeState, value: unknown, wasActive: boolean) {
  const source = record(value);
  if (!source) return;
  if (wasActive) {
    if (typeof source.status === "string") state.battle.status = boundedString(source.status, state.battle.status, 120);
    return;
  }
  const active = typeof source.active === "boolean" ? source.active : state.battle.active;
  if (!active) {
    state.battle = emptyBattle();
    return;
  }
  const maxLife = clampInt(source.enemyLifeMax, 1, 100_000) || state.battle.enemyLifeMax || 100;
  state.battle = { active: true, enemyName: boundedString(source.enemyName, state.battle.enemyName || "未知对手", 80), enemyRealm: boundedString(source.enemyRealm, state.battle.enemyRealm || "斗之气", 40), enemyLifeMax: maxLife, enemyLife: maxLife, status: boundedString(source.status, "对峙中", 120) };
}

function applyWorldEvent(state: DouQiLifeState, value: unknown) {
  const source = record(value);
  if (!source) {
    syncWorldEventAction(state, state.memory.choices[0] || "");
    return;
  }
  const title = boundedString(source.title, "未命名事件", 120);
  const type = isWorldEventType(source.type) ? source.type : "other";
  const id = boundedString(source.id, `event-${title}`, 96);
  const existing = state.memory.worldEvents.find((event) => event.id === id || event.title === title);
  const next: DouQiWorldEvent = existing || {
    id,
    type,
    title,
    location: boundedString(source.location, state.world.location, 120),
    occurredAt: `${state.world.year}年${state.world.month}月${state.world.day}日`,
    known: source.known !== false,
    status: "open",
    description: boundedString(source.description, "天地间有新的动静浮现。", 300),
  };
  if (existing) {
    next.location = boundedString(source.location, next.location, 120);
    next.description = boundedString(source.description, next.description, 300);
    next.known = typeof source.known === "boolean" ? source.known : next.known;
    if (isWorldEventStatus(source.status)) next.status = source.status;
  }
  if (!existing) state.memory.worldEvents = [next, ...state.memory.worldEvents];
  state.memory.worldEvents = state.memory.worldEvents.slice(0, MAX_WORLD_EVENTS);
  syncWorldEventAction(state, state.memory.choices[0] || "");
}

function syncWorldEventAction(state: DouQiLifeState, action: string) {
  const activeEvents = state.memory.worldEvents.filter((item) => item.status === "open" || item.status === "investigating" || item.status === "participating");
  const event = activeEvents.length === 1
    ? activeEvents[0]
    : activeEvents.find((item) => action.includes(item.title) || action.includes(item.location));
  if (!event || !action) return;
  if (/忽略|不理会|无视/.test(action)) event.status = "ignored";
  else if (/逃离|离开|避开/.test(action)) event.status = "escaped";
  else if (/调查|探查|查探|打听/.test(action)) event.status = "investigating";
  else if (/参与|加入|出手|利用|前往|赶往/.test(action)) event.status = "participating";
}

function isWorldEventType(value: unknown): value is DouQiWorldEventType {
  return ["sect_recruitment", "beast_attack", "ruins", "auction", "conflict", "mercenary", "death", "resource", "disaster", "faction_change", "other"].includes(value as DouQiWorldEventType);
}

function isWorldEventStatus(value: unknown): value is DouQiWorldEventStatus {
  return ["open", "participating", "investigating", "ignored", "resolved", "escaped"].includes(value as DouQiWorldEventStatus);
}

function worldDay(world: DouQiWorldState) {
  return world.year * 360 + (world.month - 1) * 30 + world.day;
}

function appendTimeDrivenEvents(state: DouQiLifeState, beforeDay: number, afterDay: number) {
  const elapsedMonths = Math.floor(Math.max(0, afterDay - beforeDay) / 30);
  if (!elapsedMonths) return;
  const titles = [
    ["sect_recruitment", "附近宗门开始招收弟子", "宗门的招募队伍出现在附近区域，去留皆由你定。"],
    ["resource", "山中出现稀有药材的传闻", "修士们开始谈论一处新出现的药材踪迹，真假尚未可知。"],
    ["auction", "城中将举行一场拍卖会", "商旅与佣兵陆续向城中聚集，拍卖会的消息正在扩散。"],
    ["beast_attack", "魔兽活动范围正在扩大", "远处的山林传来异动，魔兽似乎正在改变原本的活动范围。"],
  ] as const;
  for (let index = 0; index < Math.min(elapsedMonths, 4); index += 1) {
    const [type, title, description] = titles[(state.memory.worldEvents.length + index) % titles.length];
    const id = `world-${state.world.year}-${state.world.month}-${state.memory.worldEvents.length + index}`;
    if (state.memory.worldEvents.some((event) => event.id === id)) continue;
    state.memory.worldEvents.unshift({
      id,
      type,
      title,
      location: state.world.location,
      occurredAt: `${state.world.year}年${state.world.month}月${state.world.day}日`,
      known: true,
      status: "open",
      description,
    });
  }
  state.memory.worldEvents = state.memory.worldEvents.slice(0, MAX_WORLD_EVENTS);
}

function isCultivationAction(action: string) {
  if (/暂停|暂不|不闭关|停止修炼/.test(action)) return false;
  return /闭关|修炼|打坐|运转功法|炼化|吐纳/.test(action);
}

function tryBreakthrough(state: DouQiLifeState, action: string) {
  if (!/突破|晋阶|进阶/.test(action)) return undefined;
  if (state.player.qi < state.player.qiMax) return `突破尚未到时，当前斗气为 ${state.player.qi} / ${state.player.qiMax}。`;
  if (["焦虑", "恐惧", "心魔", "悲伤"].includes(state.player.mood)) {
    return `心境未稳，突破之门暂未打开。`;
  }
  state.player.qi = 0;
  state.player.qiStage += 1;
  if (state.player.qiStage > 9) {
    const realmIndex = DOU_QI_REALMS.indexOf(state.player.realm as never);
    if (realmIndex >= 0 && realmIndex < DOU_QI_REALMS.length - 1) {
      state.player.realm = DOU_QI_REALMS[realmIndex + 1];
      state.player.qiStage = 1;
      refreshProgressionCaps(state);
      return `境界已稳，踏入${state.player.realm}。`;
    }
    state.player.qiStage = 9;
  }
  refreshProgressionCaps(state);
  return `斗气凝练，你已进入${state.player.realm}${state.player.qiStage}段。`;
}

function refreshProgressionCaps(state: DouQiLifeState) {
  const realmIndex = Math.max(0, DOU_QI_REALMS.indexOf(state.player.realm as never));
  state.player.qiMax = 100 + realmIndex * 100 + (state.player.qiStage - 1) * 20;
  state.player.lifeMax = 100 + realmIndex * 12 + (state.player.qiStage - 1) * 3;
  state.player.life = Math.min(state.player.lifeMax, state.player.life + 10);
}

function applyCultivation(state: DouQiLifeState, hours: number) {
  const days = Math.max(1, Math.floor(hours / 24));
  const realmIndex = Math.max(0, DOU_QI_REALMS.indexOf(state.player.realm as never));
  const techniqueBonus = state.techniques
    .filter((item) => item.kind === "功法")
    .reduce((total, item) => total + Math.floor(item.proficiency / 25), 0);
  const talentBonus = /火|雷|风|灵|天|体|脉|感知|悟/.test(state.player.talent) ? 2 : 0;
  const moodBonus = state.player.mood === "平静" || state.player.mood === "顿悟" ? 2 : state.player.mood === "心魔" || state.player.mood === "焦虑" ? -2 : 0;
  const environmentBonus = /灵气|洞府|山谷|遗迹|药田|学院/.test(state.world.scene + state.world.location) ? 2 : 0;
  const resourceBonus = state.inventory.items.some((item) => /丹|药|魔核/.test(item.category + item.name)) ? 1 : 0;
  const gain = Math.max(1, Math.floor(days * (2 + Math.min(4, realmIndex) + techniqueBonus + talentBonus + moodBonus + environmentBonus + resourceBonus) / 2));
  const before = state.player.qi;
  state.player.qi = clamp(state.player.qi + gain, 0, state.player.qiMax);
  state.player.cultivationMethod = state.techniques.find((item) => item.kind === "功法")?.name || state.player.cultivationMethod;
  state.player.condition = "修炼后略有疲惫";
  return state.player.qi >= state.player.qiMax && before < state.player.qiMax
    ? `闭关结束，斗气已积至瓶颈（${state.player.qiStage}段），是否尝试突破。`
    : `闭关${days}日，斗气增加 ${state.player.qi - before}。`;
}

function resolveBattleAction(state: DouQiLifeState, action: string) {
  if (!state.battle.active) return "战斗已经结束。";
  if (/逃离|逃走|离开/.test(action)) {
    const enemyPower = battleRealmPower(state.battle.enemyRealm);
    const playerPower = battleRealmPower(state.player.realm) + state.player.qiStage;
    if (playerPower + (state.player.mood === "平静" ? 4 : 0) < enemyPower) {
      state.battle.status = "退路被封";
      const incoming = Math.max(1, Math.floor(enemyPower / 2));
      state.player.life = clamp(state.player.life - incoming, 0, state.player.lifeMax);
      return `你试图脱离，却被对手封住退路，承受 ${incoming} 点反击。`;
    }
    state.battle = emptyBattle();
    state.player.condition = "已脱离战斗";
    return "你抓住间隙脱离战场。";
  }
  const enemyPower = battleRealmPower(state.battle.enemyRealm);
  const playerPower = battleRealmPower(state.player.realm) + state.player.qiStage;
  let damage = 0;
  let incoming = Math.max(1, enemyPower - Math.floor(playerPower / 2));
  if (/防御|格挡|护住/.test(action)) {
    incoming = Math.max(1, Math.floor(incoming / 3));
    state.battle.status = "防守中";
  } else if (/斗技|功法|施展/.test(action) && state.techniques.some((item) => item.kind === "斗技")) {
    const technique = state.techniques.find((item) => item.kind === "斗技")!;
    const cost = Math.min(state.player.qi, 12);
    state.player.qi -= cost;
    damage = 18 + Math.floor(technique.proficiency / 8) + playerPower;
    technique.proficiency = clamp(technique.proficiency + 2, 0, 100);
    state.battle.status = `${technique.name}命中`;
  } else if (/攻击|出手|斩|拳|掌|刺|射/.test(action)) {
    const cost = Math.min(state.player.qi, 5);
    state.player.qi -= cost;
    damage = 8 + playerPower + Math.floor(state.player.qi / 20);
    state.battle.status = "交锋中";
  } else if (/移动|闪避|后撤|侧身/.test(action)) {
    incoming = Math.max(1, Math.floor(incoming / 2));
    state.battle.status = "移动中";
  } else if (/观察|感知|寻找破绽/.test(action)) {
    incoming = Math.max(1, Math.floor(incoming / 2));
    state.battle.status = "你看清了对手的破绽";
  } else if (/道具|丹药|服下|使用/.test(action)) {
    const item = state.inventory.items.find((candidate) => /丹药|疗伤|恢复/.test(candidate.category + candidate.name) && candidate.quantity > 0);
    if (item) {
      item.quantity -= 1;
      state.player.life = clamp(state.player.life + 25, 0, state.player.lifeMax);
      state.battle.status = "借丹稳住伤势";
    } else {
      state.battle.status = "手边没有可用道具";
    }
  } else {
    state.battle.status = "你在战场上寻找破绽";
    incoming = Math.max(1, Math.floor(incoming * 0.8));
  }
  state.battle.enemyLife = clamp(state.battle.enemyLife - damage, 0, state.battle.enemyLifeMax);
  if (state.battle.enemyLife <= 0) {
    state.battle = emptyBattle();
    state.player.condition = "战斗结束，气息未稳";
    return damage > 0 ? `你造成 ${damage} 点伤害，敌手已失去战力。` : "敌手已失去战力。";
  }
  state.player.life = clamp(state.player.life - incoming, 0, state.player.lifeMax);
  if (state.player.life <= 0) {
    state.player.condition = "重伤昏迷";
    state.battle.status = "你已无力再战";
  }
  return damage > 0 ? `你造成 ${damage} 点伤害，承受 ${incoming} 点反击。` : `你承受 ${incoming} 点反击。`;
}

function battleRealmPower(realm: string) {
  const index = DOU_QI_REALMS.indexOf(realm as never);
  return Math.max(1, (index < 0 ? 0 : index) * 12 + 8);
}

function openingNarrative(state: DouQiLifeState) {
  return `【时间】\n春季 · 第一年 · 第一日 · 清晨\n\n【地点】\n${state.world.location}\n\n薄云压着远山，风从你出生的地方缓缓穿过。你的故事尚未被任何人写定，天地只把第一笔留在了你面前。`;
}

function openingActionSuggestions() {
  return [
    { id: "observe", label: "观察周围", action: "我先观察周围的环境，再决定下一步行动。" },
    { id: "self", label: "查看自身", action: "我先查看自身的状态与斗气，再决定下一步。" },
    { id: "explore", label: "向前探索", action: "我向前探索，留意沿途的人与事。" },
    { id: "cultivate", label: "尝试修炼", action: "我尝试感悟体内斗气，先不闭关。" },
  ];
}

function advanceWorldTime(world: DouQiWorldState, hours: number) {
  const boundedHours = Math.min(MAX_TURN_HOURS, Math.max(0, Math.trunc(hours)));
  const currentHour = Number.isFinite(world.hour) ? Math.max(0, Math.min(23, Math.trunc(world.hour))) : periodToHour(world.period);
  const totalHours = currentHour + boundedHours;
  world.hour = totalHours % 24;
  let totalDays = Math.floor(totalHours / 24);
  while (totalDays-- > 0) {
    world.day += 1;
    if (world.day > 30) {
      world.day = 1;
      world.month += 1;
      if (world.month > 12) {
        world.month = 1;
        world.year += 1;
      }
      world.season = DOU_QI_SEASONS[Math.floor((world.month - 1) / 3)];
    }
  }
  world.period = periodForHour(world.hour);
}

function periodForHour(hour: number): DouQiWorldState["period"] {
  if (hour < 5) return "深夜";
  if (hour < 8) return "清晨";
  if (hour < 12) return "上午";
  if (hour < 16) return "午后";
  if (hour < 19) return "黄昏";
  return "夜间";
}

function periodToHour(period: DouQiWorldState["period"]) {
  return { 清晨: 6, 上午: 10, 午后: 14, 黄昏: 17, 夜间: 21, 深夜: 2 }[period] || 6;
}

function ensureMemoryState(state: DouQiLifeState) {
  state.memory = state.memory || { recentEvents: [], longTermFacts: [], choices: [], worldEvents: [] };
  state.memory.recentEvents = Array.isArray(state.memory.recentEvents) ? state.memory.recentEvents.slice(0, 12) : [];
  state.memory.longTermFacts = Array.isArray(state.memory.longTermFacts) ? state.memory.longTermFacts.slice(0, MAX_LONG_TERM_FACTS) : [];
  state.memory.choices = Array.isArray(state.memory.choices) ? state.memory.choices.slice(0, 20) : [];
  state.memory.worldEvents = Array.isArray(state.memory.worldEvents) ? state.memory.worldEvents.slice(0, MAX_WORLD_EVENTS) : [];
  state.memory.storySummary = typeof state.memory.storySummary === "string" ? state.memory.storySummary.slice(0, MAX_STORY_SUMMARY_CHARACTERS) : "";
  state.memory.unresolvedGoals = Array.isArray(state.memory.unresolvedGoals)
    ? state.memory.unresolvedGoals.filter((goal): goal is string => typeof goal === "string").slice(0, MAX_UNRESOLVED_GOALS)
    : [];
  state.memory.turnCount = Number.isFinite(state.memory.turnCount) ? Math.max(0, Math.trunc(state.memory.turnCount || 0)) : 0;
  if (!state.memory.unresolvedGoals.length) state.memory.unresolvedGoals = deriveUnresolvedGoals(state);
  if (!state.memory.storySummary) state.memory.storySummary = buildStorySummary(state);
  return state;
}

function impliedHours(action: string) {
  return cultivationHours(action) || 0;
}

function cultivationHours(action: string) {
  if (/半年/.test(action)) return 4_320;
  if (/三个月|三月/.test(action)) return 2_160;
  if (/一个月|一月/.test(action)) return 720;
  if (/一天|一日/.test(action)) return 24;
  return null;
}

function parseState(value: string): DouQiLifeState {
  try {
    const state = cloneState(JSON.parse(value) as DouQiLifeState);
    state.player = state.player || ({} as DouQiLifeState["player"]);
    state.player.age = normalizeAge(state.player.age, 18);
    state.player.livedDays = Number.isFinite(state.player.livedDays) ? Math.max(state.player.age * 360, Math.trunc(state.player.livedDays)) : state.player.age * 360;
    state.player.lifespan = Number.isFinite(state.player.lifespan) ? Math.max(state.player.age + 1, Math.trunc(state.player.lifespan)) : defaultLifespan(state.player.race || "人族");
    state.world = state.world || ({} as DouQiLifeState["world"]);
    state.world.hour = Number.isFinite(state.world.hour) ? Math.max(0, Math.min(23, Math.trunc(state.world.hour))) : periodToHour(state.world.period || "清晨");
    state.world.period = periodForHour(state.world.hour);
    state.memory = state.memory || { recentEvents: [], longTermFacts: [], choices: [], worldEvents: [] };
    state.memory.recentEvents = Array.isArray(state.memory.recentEvents) ? state.memory.recentEvents : [];
    state.memory.longTermFacts = Array.isArray(state.memory.longTermFacts) ? state.memory.longTermFacts : [];
    state.memory.choices = Array.isArray(state.memory.choices) ? state.memory.choices : [];
    state.memory.worldEvents = Array.isArray(state.memory.worldEvents) ? state.memory.worldEvents : [];
    state.npcs = Array.isArray(state.npcs)
      ? state.npcs.map((npc) => ({ ...npc, history: Array.isArray(npc.history) ? npc.history : [] }))
      : [];
    state.techniques = Array.isArray(state.techniques) ? state.techniques : [];
    state.inventory = state.inventory || { gold: 0, items: [] };
    state.inventory.items = Array.isArray(state.inventory.items) ? state.inventory.items : [];
    ensureMemoryState(state);
    return state;
  } catch { throw new DouQiLifeError("斗气人生状态损坏", 500, "STATE_INVALID"); }
}

function parseSnapshot(value: string): { title: string; state: DouQiLifeState; lastNarrative: string; messages: Array<Pick<DouQiLifeMessage, "role" | "kind" | "content" | "metadata" | "createdAt" | "updatedAt">> } {
  try {
    const source = JSON.parse(value) as Record<string, unknown>;
    const messages = Array.isArray(source.messages) ? source.messages.map((item) => { const row = record(item); return { role: row?.role === "world" ? "world" as const : "player" as const, kind: row?.kind === "narrative" ? "narrative" as const : row?.kind === "system" ? "system" as const : "action" as const, content: boundedString(row?.content, "", 20_000), metadata: record(row?.metadata) || {}, createdAt: Number(row?.createdAt) || Date.now(), updatedAt: Number(row?.updatedAt) || Date.now() }; }) : [];
    return { title: boundedString(source.title, "续行人生", 80), state: parseState(JSON.stringify(source.state)), lastNarrative: boundedString(source.lastNarrative, "", 20_000), messages };
  } catch { throw new DouQiLifeError("存档内容无效", 500, "SAVE_INVALID"); }
}

function cloneState(state: DouQiLifeState): DouQiLifeState { return JSON.parse(JSON.stringify(state)) as DouQiLifeState; }
function emptyBattle(): DouQiBattleState { return { active: false, enemyName: "", enemyRealm: "", enemyLife: 0, enemyLifeMax: 0, status: "" }; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function parseRecord(value: string): Record<string, unknown> { try { return record(JSON.parse(value)) || {}; } catch { return {}; } }
function optionalText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function requiredText(value: unknown, max: number, label: string) { const text = optionalText(value, max); if (!text) throw new DouQiLifeError(`请输入${label}`); return text; }
function boundedString(value: unknown, fallback: string, max: number) { return optionalText(value, max) || fallback; }
function normalizeAge(value: unknown, fallback: number) { const age = typeof value === "number" || typeof value === "string" ? Number(value) : fallback; return Number.isFinite(age) ? clampInt(age, 1, 999) : fallback; }
function clampInt(value: unknown, min: number, max: number) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : 0; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function validId(value: unknown, label: string) { const id = typeof value === "string" ? value.trim() : ""; if (!ID_PATTERN.test(id)) throw new DouQiLifeError(`${label}无效`); return id; }

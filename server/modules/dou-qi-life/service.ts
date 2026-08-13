import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import { DOU_QI_MOODS, DOU_QI_PERIODS, DOU_QI_REALMS, DOU_QI_SEASONS, type DouQiBattleState, type DouQiLifeCharacterInput, type DouQiLifeMessage, type DouQiLifeSave, type DouQiLifeSession, type DouQiLifeState, type DouQiLifeTurnResult, type DouQiNpcState, type DouQiTechnique, type DouQiWorldState } from "./types";

const MAX_SESSIONS_PER_USER = 20;
const MAX_SAVES_PER_USER = 50;
const MAX_MESSAGES_PER_SESSION = 400;
const MAX_INVENTORY_ITEMS = 48;
const MAX_TECHNIQUES = 32;
const MAX_ACTION_CHARACTERS = 4_000;
const MAX_TEXT_CHARACTERS = 240;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DEFAULT_LOCATION = "加玛帝国 · 青山镇外围";

export class DouQiLifeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "DOU_QI_LIFE_INVALID") {
    super(message);
    this.name = "DouQiLifeError";
  }
}

export function createDouQiLifeService(database: Database, options: { now?: () => number } = {}) {
  const now = options.now || Date.now;

  database
    .query("UPDATE douqi_life_messages SET status = 'failed', error = ?, updated_at = ? WHERE status = 'streaming'")
    .run("服务重启，本次世界回应已中断", now());

  function listSessions(userId: string) {
    return (database.query("SELECT * FROM douqi_life_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, MAX_SESSIONS_PER_USER) as DouQiSessionRow[]).map(sessionFromRow);
  }

  function createSession(userId: string, input: unknown = {}) {
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_sessions WHERE user_id = ?").get(userId) as { count: number }).count);
    if (count >= MAX_SESSIONS_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请删除不再继续的人生", 409, "SESSION_LIMIT");
    const character = normalizeCharacter(input);
    const timestamp = now();
    const state = createInitialState(character);
    const session: DouQiLifeSession = {
      id: randomUUID(),
      title: `${character.name} 的斗气人生`,
      status: "active",
      state,
      lastNarrative: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.query("INSERT INTO douqi_life_sessions(user_id, session_id, title, status, state_json, last_narrative, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)").run(userId, session.id, session.title, session.status, JSON.stringify(state), timestamp, timestamp);
    return session;
  }

  function getSession(userId: string, sessionId: string) {
    const row = database.query("SELECT * FROM douqi_life_sessions WHERE user_id = ? AND session_id = ?").get(userId, validId(sessionId, "人生 ID")) as DouQiSessionRow | null;
    return row ? sessionFromRow(row) : null;
  }

  function getSessionWithHistory(userId: string, sessionId: string) {
    const session = getSession(userId, sessionId);
    if (!session) return null;
    const messages = (database.query("SELECT * FROM douqi_life_messages WHERE user_id = ? AND session_id = ? ORDER BY rowid ASC LIMIT ?").all(userId, session.id, MAX_MESSAGES_PER_SESSION) as DouQiMessageRow[]).map(messageFromRow);
    return { session, messages };
  }

  function beginTurn(userId: string, sessionId: string, action: unknown) {
    const session = requireSession(userId, sessionId);
    if (session.status !== "active") throw new DouQiLifeError("这段人生已经结束，请读取其他存档继续", 409, "SESSION_ENDED");
    const pending = database
      .query("SELECT 1 FROM douqi_life_messages WHERE user_id = ? AND session_id = ? AND role = 'world' AND status = 'streaming' LIMIT 1")
      .get(userId, session.id);
    if (pending) throw new DouQiLifeError("上一段世界回应尚未完成，请稍候", 409, "TURN_IN_PROGRESS");
    const content = requiredText(action, MAX_ACTION_CHARACTERS, "行动");
    const timestamp = now();
    const playerMessage: DouQiLifeMessage = {
      id: randomUUID(), sessionId: session.id, role: "player", kind: "action", content, metadata: {}, status: "completed", error: "", createdAt: timestamp, updatedAt: timestamp,
    };
    const worldMessage: DouQiLifeMessage = {
      id: randomUUID(), sessionId: session.id, role: "world", kind: "narrative", content: "", metadata: {}, status: "streaming", error: "", createdAt: timestamp + 1, updatedAt: timestamp + 1,
    };
    database.transaction(() => {
      database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(userId, playerMessage.id, session.id, playerMessage.role, playerMessage.kind, playerMessage.content, "{}", playerMessage.status, "", playerMessage.createdAt, playerMessage.updatedAt);
      database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(userId, worldMessage.id, session.id, worldMessage.role, worldMessage.kind, "", "{}", worldMessage.status, "", worldMessage.createdAt, worldMessage.updatedAt);
      database.query("UPDATE douqi_life_sessions SET updated_at = ? WHERE user_id = ? AND session_id = ?").run(timestamp, userId, session.id);
    })();
    return { session: { ...session, updatedAt: timestamp }, playerMessage, worldMessage, recentMessages: thisContextMessages(userId, session.id) };
  }

  function completeTurn(userId: string, sessionId: string, worldMessageId: string, result: DouQiLifeTurnResult, action: string) {
    const session = requireSession(userId, sessionId);
    const message = getMessage(userId, worldMessageId, session.id);
    if (!message || message.role !== "world" || message.status !== "streaming") throw new DouQiLifeError("世界回应不存在或已经处理", 404, "MESSAGE_NOT_FOUND");
    const timestamp = now();
    const state = applyTurnState(session.state, action, result.statePatch, result.narrative);
    const metadata = { suggestions: result.suggestions, notice: result.notice || "" };
    database.transaction(() => {
      database.query("UPDATE douqi_life_messages SET content = ?, metadata_json = ?, status = 'completed', error = '', updated_at = ? WHERE user_id = ? AND message_id = ? AND session_id = ?").run(result.narrative.slice(0, 20_000), JSON.stringify(metadata), timestamp, userId, message.id, session.id);
      database.query("UPDATE douqi_life_sessions SET state_json = ?, last_narrative = ?, updated_at = ? WHERE user_id = ? AND session_id = ?").run(JSON.stringify(state), result.narrative.slice(0, 20_000), timestamp, userId, session.id);
      trimMessages(userId, session.id);
    })();
    return { session: { ...session, state, lastNarrative: result.narrative.slice(0, 20_000), updatedAt: timestamp }, worldMessage: { ...message, content: result.narrative.slice(0, 20_000), metadata, status: "completed" as const, updatedAt: timestamp }, suggestions: result.suggestions, notice: result.notice || "" };
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
    const detail = getSessionWithHistory(userId, sessionId);
    if (!detail) throw new DouQiLifeError("人生不存在", 404, "SESSION_NOT_FOUND");
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_saves WHERE user_id = ?").get(userId) as { count: number }).count);
    if (count >= MAX_SAVES_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请删除旧存档", 409, "SAVE_LIMIT");
    const timestamp = now();
    const save: DouQiLifeSave = { id: randomUUID(), sessionId: detail.session.id, title: optionalText(title, 80) || detail.session.title, createdAt: timestamp, updatedAt: timestamp };
    const snapshot = { title: detail.session.title, state: detail.session.state, lastNarrative: detail.session.lastNarrative, messages: detail.messages.slice(-120) };
    database.query("INSERT INTO douqi_life_saves(user_id, save_id, session_id, title, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, save.id, save.sessionId, save.title, JSON.stringify(snapshot), timestamp, timestamp);
    return save;
  }

  function listSaves(userId: string, sessionId?: string) {
    const rows = sessionId ? database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, validId(sessionId, "人生 ID"), MAX_SAVES_PER_USER) : database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, MAX_SAVES_PER_USER);
    return (rows as DouQiSaveRow[]).map(saveFromRow);
  }

  function restoreSave(userId: string, saveId: string) {
    const row = database.query("SELECT * FROM douqi_life_saves WHERE user_id = ? AND save_id = ?").get(userId, validId(saveId, "存档 ID")) as DouQiSaveRow | null;
    if (!row) throw new DouQiLifeError("存档不存在", 404, "SAVE_NOT_FOUND");
    const count = Number((database.query("SELECT COUNT(*) AS count FROM douqi_life_sessions WHERE user_id = ?").get(userId) as { count: number }).count);
    if (count >= MAX_SESSIONS_PER_USER) throw new DouQiLifeError("斗气人生存档已达上限，请先删除不再继续的人生", 409, "SESSION_LIMIT");
    const snapshot = parseSnapshot(row.snapshot_json);
    const timestamp = now();
    const session: DouQiLifeSession = { id: randomUUID(), title: `${snapshot.title} · 续`, status: "active", state: snapshot.state, lastNarrative: snapshot.lastNarrative, createdAt: timestamp, updatedAt: timestamp };
    database.transaction(() => {
      database.query("INSERT INTO douqi_life_sessions(user_id, session_id, title, status, state_json, last_narrative, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, session.id, session.title, session.status, JSON.stringify(session.state), session.lastNarrative, timestamp, timestamp);
      const insert = database.query("INSERT INTO douqi_life_messages(user_id, message_id, session_id, role, kind, content, metadata_json, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const source of snapshot.messages) insert.run(userId, randomUUID(), session.id, source.role, source.kind, source.content, JSON.stringify(source.metadata || {}), "completed", "", source.createdAt, source.updatedAt);
    })();
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

  function thisContextMessages(userId: string, sessionId: string) {
    return (database.query("SELECT * FROM douqi_life_messages WHERE user_id = ? AND session_id = ? ORDER BY rowid DESC LIMIT 24").all(userId, sessionId) as DouQiMessageRow[]).reverse().map(messageFromRow);
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

  return { listSessions, createSession, getSession, getSessionWithHistory, beginTurn, completeTurn, failTurn, saveSession, listSaves, restoreSave, deleteSave, deleteSession, context };
}

type DouQiSessionRow = { session_id: string; title: string; status: string; state_json: string; last_narrative: string; created_at: number; updated_at: number };
type DouQiMessageRow = { message_id: string; session_id: string; role: string; kind: string; content: string; metadata_json: string; status: string; error: string; created_at: number; updated_at: number };
type DouQiSaveRow = { save_id: string; session_id: string; title: string; snapshot_json: string; created_at: number; updated_at: number };

function sessionFromRow(row: DouQiSessionRow): DouQiLifeSession {
  return { id: row.session_id, title: row.title, status: row.status === "ended" ? "ended" : "active", state: parseState(row.state_json), lastNarrative: row.last_narrative || "", createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function messageFromRow(row: DouQiMessageRow): DouQiLifeMessage {
  return { id: row.message_id, sessionId: row.session_id, role: row.role === "world" ? "world" : "player", kind: row.kind === "narrative" ? "narrative" : row.kind === "system" ? "system" : "action", content: row.content, metadata: parseRecord(row.metadata_json), status: row.status === "streaming" ? "streaming" : row.status === "failed" ? "failed" : "completed", error: row.error || "", createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function saveFromRow(row: DouQiSaveRow): DouQiLifeSave {
  return { id: row.save_id, sessionId: row.session_id, title: row.title, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
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

function createInitialState(character: ReturnType<typeof normalizeCharacter>): DouQiLifeState {
  return { player: { ...character, realm: "斗之气", qiStage: 1, qi: 10, qiMax: 100, life: 100, lifeMax: 100, condition: "正常", mood: "平静", cultivationMethod: "无" }, world: { year: 1, season: "春季", month: 1, day: 1, period: "清晨", location: character.birthplace || DEFAULT_LOCATION, weather: "薄云，风息平和", scene: "一切尚未定形。" }, npcs: [], inventory: { gold: 20, items: [] }, techniques: [], battle: emptyBattle(), memory: { recentEvents: [], longTermFacts: [`${character.name} 来自 ${character.birthplace || DEFAULT_LOCATION}。`], choices: [] } };
}

function applyTurnState(state: DouQiLifeState, action: string, patch: unknown, narrative: string): DouQiLifeState {
  const source = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const next = cloneState(state);
  const hours = clampInt(source.advanceTimeHours, 0, 720);
  advanceWorldTime(next.world, hours || impliedHours(action));
  const world = record(source.world);
  if (world) {
    next.world.location = boundedString(world.location, next.world.location, 120);
    next.world.weather = boundedString(world.weather, next.world.weather, 120);
    next.world.scene = boundedString(world.scene, next.world.scene, 1_000);
  }
  const player = record(source.player);
  if (player) {
    next.player.qi = clamp(next.player.qi + clampInt(player.qiDelta, -40, 60), 0, next.player.qiMax);
    next.player.life = clamp(next.player.life + clampInt(player.lifeDelta, -40, 40), 0, next.player.lifeMax);
    if (typeof player.mood === "string" && DOU_QI_MOODS.includes(player.mood as never)) next.player.mood = player.mood as typeof next.player.mood;
    next.player.condition = boundedString(player.condition, next.player.condition, 120);
  }
  if (next.player.qi >= next.player.qiMax && /突破|晋阶|进阶/.test(action)) {
    next.player.qi = 0;
    next.player.qiStage += 1;
    if (next.player.qiStage > 9) {
      const realmIndex = DOU_QI_REALMS.indexOf(next.player.realm as never);
      if (realmIndex >= 0 && realmIndex < DOU_QI_REALMS.length - 1) {
        next.player.realm = DOU_QI_REALMS[realmIndex + 1];
        next.player.qiStage = 1;
      } else next.player.qiStage = 9;
    }
  }
  next.inventory.gold = clamp(next.inventory.gold + clampInt(source.goldDelta, -100, 1_000), 0, 1_000_000);
  const addItems = Array.isArray(source.addItems) ? source.addItems : [];
  for (const value of addItems.slice(0, 5)) {
    const item = record(value);
    const name = boundedString(item?.name, "未知物品", 80);
    const existing = next.inventory.items.find((candidate) => candidate.name === name);
    if (existing) existing.quantity = clamp(existing.quantity + clampInt(item?.quantity, 1, 10), 1, 999);
    else if (next.inventory.items.length < MAX_INVENTORY_ITEMS) next.inventory.items.push({ id: randomUUID(), name, category: boundedString(item?.category, "材料", 40), quantity: clampInt(item?.quantity, 1, 10), description: boundedString(item?.description, "尚待确认用途", 180) });
  }
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
  if (narrative.trim()) next.memory.recentEvents = [narrative.trim().slice(0, 300), ...next.memory.recentEvents].slice(0, 12);
  applyBattlePatch(next, source.battle);
  return next;
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
      existing.relationship = clamp(existing.relationship + clampInt(source?.relationshipDelta, -10, 10), -100, 100);
      existing.impression = boundedString(source?.impression, existing.impression, 300);
      const history = boundedString(source?.history, "", 300);
      if (history) existing.history = [history, ...existing.history].slice(0, 12);
      existing.lastSeenAt = `${state.world.year}年${state.world.month}月${state.world.day}日`;
    } else state.npcs.push({ id, name, identity: boundedString(source?.identity, "过客", 80), realm: boundedString(source?.realm, "斗之气", 40), faction: boundedString(source?.faction, "无", 80), personality: boundedString(source?.personality, "尚未看清", 160), goal: boundedString(source?.goal, "未知", 160), relationship: clamp(clampInt(source?.relationship, 0, 10), -100, 100), impression: boundedString(source?.impression, "初见", 300), history: [], secret: boundedString(source?.secret, "", 300), lastSeenAt: `${state.world.year}年${state.world.month}月${state.world.day}日` });
  }
  state.npcs = state.npcs.slice(0, 24);
}

function applyBattlePatch(state: DouQiLifeState, value: unknown) {
  const source = record(value);
  if (!source) return;
  const active = typeof source.active === "boolean" ? source.active : state.battle.active;
  if (!active) {
    state.battle = emptyBattle();
    return;
  }
  const maxLife = clampInt(source.enemyLifeMax, 1, 100_000) || state.battle.enemyLifeMax || 100;
  const enemyLife = source.enemyLife === undefined
    ? state.battle.enemyLife > 0 ? Math.min(state.battle.enemyLife, maxLife) : maxLife
    : clampInt(source.enemyLife, 0, maxLife);
  state.battle = { active: true, enemyName: boundedString(source.enemyName, state.battle.enemyName || "未知对手", 80), enemyRealm: boundedString(source.enemyRealm, state.battle.enemyRealm || "斗之气", 40), enemyLifeMax: maxLife, enemyLife, status: boundedString(source.status, "对峙中", 120) };
}

function advanceWorldTime(world: DouQiWorldState, hours: number) {
  const boundedHours = Math.min(720, Math.max(0, Math.trunc(hours)));
  const periodSteps = Math.floor(boundedHours / 4);
  const currentPeriod = Math.max(0, DOU_QI_PERIODS.indexOf(world.period));
  world.period = DOU_QI_PERIODS[(currentPeriod + periodSteps) % DOU_QI_PERIODS.length];
  let totalDays = Math.floor(boundedHours / 24);
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
}

function impliedHours(action: string) {
  if (/半年/.test(action)) return 720;
  if (/三个月|三月/.test(action)) return 720;
  if (/一个月|一月/.test(action)) return 720;
  if (/一天|一日/.test(action)) return 24;
  return 0;
}

function parseState(value: string): DouQiLifeState {
  try { return cloneState(JSON.parse(value) as DouQiLifeState); } catch { throw new DouQiLifeError("斗气人生状态损坏", 500, "STATE_INVALID"); }
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

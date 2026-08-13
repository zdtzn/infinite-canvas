export const DOU_QI_REALMS = [
  "斗之气",
  "斗者",
  "斗师",
  "大斗师",
  "斗灵",
  "斗王",
  "斗皇",
  "斗宗",
  "斗尊",
  "半圣",
  "斗圣",
  "斗帝",
] as const;

export const DOU_QI_MOODS = [
  "平静",
  "焦虑",
  "愤怒",
  "恐惧",
  "执念",
  "杀意",
  "悲伤",
  "心魔",
  "顿悟",
] as const;

export const DOU_QI_PERIODS = ["清晨", "上午", "午后", "黄昏", "夜间", "深夜"] as const;
export const DOU_QI_SEASONS = ["春季", "夏季", "秋季", "冬季"] as const;

export type DouQiMood = (typeof DOU_QI_MOODS)[number];
export type DouQiPeriod = (typeof DOU_QI_PERIODS)[number];
export type DouQiSeason = (typeof DOU_QI_SEASONS)[number];

export type DouQiPlayerState = {
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
  mood: DouQiMood;
  cultivationMethod: string;
};

export type DouQiWorldState = {
  year: number;
  season: DouQiSeason;
  month: number;
  day: number;
  period: DouQiPeriod;
  location: string;
  weather: string;
  scene: string;
};

export type DouQiNpcState = {
  id: string;
  name: string;
  identity: string;
  realm: string;
  faction: string;
  personality: string;
  goal: string;
  relationship: number;
  impression: string;
  history: string[];
  secret: string;
  lastSeenAt: string;
};

export type DouQiItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  description: string;
};

export type DouQiInventoryState = {
  gold: number;
  items: DouQiItem[];
};

export type DouQiTechnique = {
  id: string;
  name: string;
  kind: "功法" | "斗技";
  grade: string;
  attribute: string;
  effect: string;
  proficiency: number;
  source: string;
};

export type DouQiBattleState = {
  active: boolean;
  enemyName: string;
  enemyRealm: string;
  enemyLife: number;
  enemyLifeMax: number;
  status: string;
};

export type DouQiWorldEventType =
  | "sect_recruitment"
  | "beast_attack"
  | "ruins"
  | "auction"
  | "conflict"
  | "mercenary"
  | "death"
  | "resource"
  | "disaster"
  | "faction_change"
  | "other";

export type DouQiWorldEventStatus =
  | "open"
  | "participating"
  | "investigating"
  | "ignored"
  | "resolved"
  | "escaped";

export type DouQiWorldEvent = {
  id: string;
  type: DouQiWorldEventType;
  title: string;
  location: string;
  occurredAt: string;
  known: boolean;
  status: DouQiWorldEventStatus;
  description: string;
};

export type DouQiMemoryState = {
  recentEvents: string[];
  longTermFacts: string[];
  choices: string[];
  worldEvents: DouQiWorldEvent[];
};

export type DouQiLifeState = {
  player: DouQiPlayerState;
  world: DouQiWorldState;
  npcs: DouQiNpcState[];
  inventory: DouQiInventoryState;
  techniques: DouQiTechnique[];
  battle: DouQiBattleState;
  memory: DouQiMemoryState;
};

export type DouQiLifeMessage = {
  id: string;
  sessionId: string;
  role: "player" | "world";
  kind: "action" | "narrative" | "system";
  content: string;
  metadata: Record<string, unknown>;
  status: "streaming" | "completed" | "failed";
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type DouQiLifeSession = {
  id: string;
  title: string;
  status: "active" | "ended";
  state: DouQiLifeState;
  lastNarrative: string;
  createdAt: number;
  updatedAt: number;
};

export type DouQiLifeSuggestion = {
  id: string;
  label: string;
  action: string;
};

export type DouQiSuggestion = DouQiLifeSuggestion;

export type DouQiLifeTurnResult = {
  narrative: string;
  suggestions: DouQiLifeSuggestion[];
  statePatch?: unknown;
  notice?: string;
};

export type DouQiLifeCharacterInput = {
  name?: unknown;
  gender?: unknown;
  age?: unknown;
  birthplace?: unknown;
  race?: unknown;
  familyBackground?: unknown;
  personality?: unknown;
  appearance?: unknown;
  lifeGoal?: unknown;
  talent?: unknown;
  randomize?: unknown;
};

export type DouQiLifeSave = {
  id: string;
  sessionId: string;
  title: string;
  kind: "auto" | "manual";
  createdAt: number;
  updatedAt: number;
};

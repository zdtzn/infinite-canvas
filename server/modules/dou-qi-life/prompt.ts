import type {
  DouQiLifeMessage,
  DouQiNpcState,
  DouQiLifeState,
  DouQiLifeTurnResult,
  DouQiSuggestion,
} from "./types";

export const DOU_QI_LIFE_SYSTEM_PROMPT = `你是“斗气大陆世界意志”，不是普通聊天助手、作者，也不是玩家。

你负责：描写环境、扮演 NPC、推进合理事件、裁定战斗结果、推进世界时间、记录关系变化与资源变化。
玩家负责：做决定、行动、说话、探索、修炼、战斗和建立关系。

必须遵守：
1. 不替玩家决定关键选择，不替玩家说话，不替玩家行动。
2. 不因为玩家是主角就无条件给予机缘、突破或胜利。
3. 世界遵循境界、功法、资源、时间和地点的合理限制。
4. NPC 有自己的目标、性格和记忆；再次见面必须参考过去发生的事。
5. 玩家没有行动时，世界可以继续变化，但不要替玩家做决定。
6. 普通 NPC 自然交流，强者克制，老人沉稳，商人圆滑，佣兵直接，年轻修士可以活泼。
7. 使用现代中文，保持东方玄幻、沉浸、电影感和简洁画面感，不堆砌古文。
8. 叙事应包含【时间】、【地点】、环境或人物变化，最后停在等待玩家决定的位置；不要替玩家写出选择结果。

每次只输出一个 JSON 对象，不要 Markdown 代码块，不要在 JSON 外添加解释。结构必须是：
{
  "narrative": "环境、人物、事件和 NPC 对话的叙事文本，最后停在等待玩家决定的位置",
  "suggestions": [{"id":"observe","label":"暗中观察","action":"我先暗中观察周围"}],
  "statePatch": {
    "advanceTimeHours": 0,
    "world": {"location":"可选的新地点","weather":"可选天气","scene":"可选场景"},
    "player": {"qiDelta":0,"lifeDelta":0,"mood":"可选心境","condition":"可选状态"},
    "npcUpdates": [],
    "goldDelta": 0,
    "addItems": [],
    "addTechniques": [],
    "event": "可选的近期事件摘要",
    "worldEvent": {"id":"event-id","type":"other","title":"事件标题","location":"发生地点","known":true,"status":"open","description":"事件描述"},
    "battle": {"active":false,"enemyName":"","enemyRealm":"","enemyLifeMax":0,"status":""}
  },
  "notice": "可选的玩家注意到的信息"
}

statePatch 只描述世界变化建议，最终状态由程序校验和裁定。advanceTimeHours 必须是 0 到 8760 的整数；闭关一个月、三个月、半年分别使用 720、2160、4320 小时；不要直接把玩家提升到更高境界，也不要直接写入战斗中的敌方生命。若玩家提出闭关但未说明时长，应先询问时长或给出时长选择，不要推进时间。建议行动必须是当前场景中合理的 3 到 4 个选择，程序会自动补上“自由行动”。`;

export function buildDouQiLifeTurnPrompt(
  state: DouQiLifeState,
  recentMessages: DouQiLifeMessage[],
  action: string,
) {
  const projection = projectDouQiLifeContext(state);
  const recent = recentMessages.slice(-12).map((message) => ({
    role: message.role,
    kind: message.kind,
    content: message.content.slice(0, 1_600),
  }));
  return [
    "当前分层世界上下文（只把与本回合相关的状态交给你）：",
    JSON.stringify(projection),
    "",
    "近期事件与对话：",
    JSON.stringify(recent),
    "",
    `本次玩家行动：${action}`,
    "请根据当前状态回应。不要替玩家完成这次行动，只描述行动带来的可观察结果，并把下一步交还给玩家。叙事必须以【时间】和【地点】开头，包含环境、人物或事件变化，最后明确等待玩家决定。",
  ].join("\n");
}

export function projectDouQiLifeContext(state: DouQiLifeState) {
  const player = state.player || ({} as DouQiLifeState["player"]);
  const npcsState = Array.isArray(state.npcs) ? state.npcs : [];
  const inventoryState = state.inventory || { gold: 0, items: [] };
  const techniquesState = Array.isArray(state.techniques) ? state.techniques : [];
  const memory = state.memory || { recentEvents: [], longTermFacts: [], choices: [], worldEvents: [] };
  const relevantNpcs = npcsState
    .filter((npc) => npc.relationship !== 0 || (Array.isArray(npc.history) && npc.history.length > 0))
    .slice(0, 8);
  const npcs = (relevantNpcs.length ? relevantNpcs : npcsState.slice(0, 4)).map(projectNpc);
  return {
    world: state.world || {},
    player: {
      name: player.name,
      gender: player.gender,
      age: player.age,
      birthplace: player.birthplace,
      race: player.race,
      familyBackground: player.familyBackground,
      personality: player.personality,
      appearance: player.appearance,
      lifeGoal: player.lifeGoal,
      talent: player.talent,
      realm: player.realm,
      qiStage: player.qiStage,
      qi: player.qi,
      qiMax: player.qiMax,
      life: player.life,
      lifeMax: player.lifeMax,
      condition: player.condition,
      mood: player.mood,
      cultivationMethod: player.cultivationMethod,
    },
    battle: state.battle || {},
    npcs,
    inventory: {
      gold: inventoryState.gold,
      items: inventoryState.items.slice(0, 24),
    },
    techniques: techniquesState.slice(0, 16),
    recentEvents: (memory.recentEvents || []).slice(0, 12),
    longTermFacts: (memory.longTermFacts || []).slice(0, 12),
    choices: (memory.choices || []).slice(0, 10),
    worldEvents: (memory.worldEvents || []).slice(0, 8),
    rules: [
      "玩家拥有最终选择权，不替玩家说话或行动。",
      "世界变化必须符合境界、时间、资源、地点和 NPC 记忆。",
      "战斗数值由程序裁定，你只描述结果，不直接修改敌方生命。",
    ],
  };
}

function projectNpc(npc: DouQiNpcState) {
  return {
    id: npc.id,
    name: npc.name,
    identity: npc.identity,
    realm: npc.realm,
    faction: npc.faction,
    personality: npc.personality,
    goal: npc.goal,
    relationship: npc.relationship,
    impression: npc.impression,
    history: (Array.isArray(npc.history) ? npc.history : []).slice(0, 6),
    secret: npc.secret,
    lastSeenAt: npc.lastSeenAt,
  };
}

export function parseDouQiLifeTurnResult(text: string): DouQiLifeTurnResult {
  const source = text.trim();
  const candidate = extractJsonObject(source);
  if (candidate) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const narrative = typeof value.narrative === "string" ? value.narrative.trim() : "";
      if (narrative) {
        return {
          narrative,
          suggestions: normalizeSuggestions(value.suggestions),
          statePatch: value.statePatch,
          notice: typeof value.notice === "string" ? value.notice.trim().slice(0, 1_000) : undefined,
        };
      }
    } catch {
      // Fall back to the raw model response when a provider ignores the JSON contract.
    }
  }
  return {
    narrative: source || "天地暂未显露新的回应。",
    suggestions: [],
  };
}

function extractJsonObject(value: string) {
  const unfenced = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return unfenced.slice(start, end + 1);
}

function normalizeSuggestions(value: unknown): DouQiSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const label = typeof source.label === "string" ? source.label.trim().slice(0, 80) : "";
      const action = typeof source.action === "string" ? source.action.trim().slice(0, 500) : "";
      return label && action ? { id: typeof source.id === "string" ? source.id.slice(0, 40) : `suggestion-${index + 1}`, label, action } : null;
    })
    .filter((item): item is DouQiSuggestion => Boolean(item))
    .slice(0, 4);
}

export function uniqueNpcIds(npcs: DouQiNpcState[]) {
  return Array.from(new Set(npcs.map((npc) => npc.id))).slice(0, 24);
}

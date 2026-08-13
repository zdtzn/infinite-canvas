import type {
  DouQiLifeMessage,
  DouQiLifeState,
  DouQiLifeTurnResult,
  DouQiNpcState,
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
    "event": "可选的近期事件",
    "battle": {"active":false,"enemyName":"","enemyRealm":"","enemyLife":0,"status":""}
  },
  "notice": "可选的玩家注意到的信息"
}

statePatch 只描述世界变化建议，最终状态由程序校验和裁定。advanceTimeHours 必须是 0 到 720 的整数；不要直接把玩家提升到更高境界。建议行动必须是当前场景中合理的 3 到 4 个选择，程序会自动补上“自由行动”。`;

export function buildDouQiLifeTurnPrompt(
  state: DouQiLifeState,
  recentMessages: DouQiLifeMessage[],
  action: string,
) {
  const recent = recentMessages.slice(-12).map((message) => ({
    role: message.role,
    kind: message.kind,
    content: message.content.slice(0, 2_000),
  }));
  return [
    "当前结构化世界状态：",
    JSON.stringify(state),
    "",
    "近期事件与对话：",
    JSON.stringify(recent),
    "",
    `本次玩家行动：${action}`,
    "请根据当前状态回应。不要替玩家完成这次行动，只描述行动带来的可观察结果，并把下一步交还给玩家。",
  ].join("\n");
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

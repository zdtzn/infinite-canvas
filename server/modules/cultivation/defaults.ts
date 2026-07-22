import type { PromotionPolicy } from "./policy";

export const DEFAULT_CAPABILITIES = [
  ["generation.hd", "高清生成", "generation"],
  ["generation.inpaint", "局部重绘", "generation"],
  ["generation.outpaint", "扩图", "generation"],
  ["generation.references", "参考图", "generation"],
  ["feature.lora", "LoRA", "feature"],
  ["feature.controlnet", "ControlNet", "feature"],
  ["model.gpt-image", "GPT Image", "model"],
  ["model.gemini", "Gemini", "model"],
  ["model.flux", "Flux", "model"],
] as const;

type RealmSeed = {
  code: string;
  name: string;
  stageCount: number;
  stageSuffix: "段" | "星" | "转" | "none";
  color: string;
  iconKey: string;
  dailyLimit: number | null;
  maxConcurrency: number;
  promotionPolicy: PromotionPolicy;
};

export const DEFAULT_REALMS: RealmSeed[] = [
  {
    code: "dou-qi",
    name: "斗之气",
    stageCount: 9,
    stageSuffix: "段",
    color: "#64748b",
    iconKey: "Gauge",
    dailyLimit: 10,
    maxConcurrency: 1,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-zhe",
    name: "斗者",
    stageCount: 9,
    stageSuffix: "星",
    color: "#0f766e",
    iconKey: "Sparkles",
    dailyLimit: 20,
    maxConcurrency: 1,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-shi",
    name: "斗师",
    stageCount: 9,
    stageSuffix: "星",
    color: "#2563eb",
    iconKey: "Orbit",
    dailyLimit: 40,
    maxConcurrency: 1,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "da-dou-shi",
    name: "大斗师",
    stageCount: 9,
    stageSuffix: "星",
    color: "#4f46e5",
    iconKey: "Shield",
    dailyLimit: 60,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-ling",
    name: "斗灵",
    stageCount: 9,
    stageSuffix: "星",
    color: "#7c3aed",
    iconKey: "Diamond",
    dailyLimit: 80,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-wang",
    name: "斗王",
    stageCount: 9,
    stageSuffix: "星",
    color: "#be185d",
    iconKey: "Crown",
    dailyLimit: 100,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-huang",
    name: "斗皇",
    stageCount: 9,
    stageSuffix: "星",
    color: "#c2410c",
    iconKey: "Sun",
    dailyLimit: 120,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-zong",
    name: "斗宗",
    stageCount: 9,
    stageSuffix: "星",
    color: "#b45309",
    iconKey: "Hexagon",
    dailyLimit: 150,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-zun",
    name: "斗尊",
    stageCount: 9,
    stageSuffix: "星",
    color: "#047857",
    iconKey: "Aperture",
    dailyLimit: 180,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-zun-peak",
    name: "斗尊巅峰",
    stageCount: 10,
    stageSuffix: "转",
    color: "#0369a1",
    iconKey: "Waves",
    dailyLimit: 200,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "half-saint",
    name: "半圣",
    stageCount: 1,
    stageSuffix: "none",
    color: "#4338ca",
    iconKey: "CircleDot",
    dailyLimit: 240,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-saint",
    name: "斗圣",
    stageCount: 9,
    stageSuffix: "星",
    color: "#9f1239",
    iconKey: "Star",
    dailyLimit: 300,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
  {
    code: "dou-emperor",
    name: "斗帝",
    stageCount: 9,
    stageSuffix: "星",
    color: "#111827",
    iconKey: "Infinity",
    dailyLimit: null,
    maxConcurrency: 2,
    promotionPolicy: "boundary_manual",
  },
];

const CHINESE_NUMBERS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];

export function stageLabel(realm: RealmSeed, index: number) {
  if (realm.stageSuffix === "none") return realm.name;
  return `${CHINESE_NUMBERS[index - 1] || index}${realm.stageSuffix}`;
}

export function requiredXp(realmIndex: number, stageIndex: number) {
  return 100 + realmIndex * 350 + (stageIndex - 1) * 75;
}

export type ChatPresetId = "general" | "prompt-smith" | "image-reader" | "product-strategist" | "copy-polisher" | "tech-helper" | "linruolan" | "catgirl" | "moxuan";

export type ChatPresetOption = {
    id: ChatPresetId;
    label: string;
    description: string;
    hint: string;
    greeting: string;
    tags: readonly string[];
};

export const defaultChatPresetId: ChatPresetId = "general";

export const chatPresetOptions: readonly ChatPresetOption[] = [
    {
        id: "general",
        label: "通用问道",
        description: "上下文理解、创作讨论和综合咨询",
        hint: "自然可靠，先理解真实意图再回答",
        greeting: "欢迎来到问道台。把问题、灵感或正在推进的事情交给我，我们从本质处一起梳理。",
        tags: ["综合", "创作", "分析"],
    },
    {
        id: "prompt-smith",
        label: "提示词炼师",
        description: "优化生图提示词，拆解风格、构图和约束",
        hint: "适合把想法炼成可复制提示词",
        greeting: "把你的想法交来，我会先守住原意，再把它炼成更稳定、可直接使用的提示词。",
        tags: ["Prompt", "构图", "风格"],
    },
    {
        id: "image-reader",
        label: "画面参详",
        description: "上传图片后分析构图、风格、清晰度和问题",
        hint: "适合看图提问和复盘画面",
        greeting: "请上传一张画面。我们先看清它已经有什么，再判断下一步该改什么。",
        tags: ["看图", "构图", "复盘"],
    },
    {
        id: "product-strategist",
        label: "商品策划",
        description: "提炼商品卖点，规划主图、详情页和海报方向",
        hint: "适合电商图片和商品文案",
        greeting: "把商品图和目标交给我，我会先辨清商品事实，再规划能落地的视觉方案。",
        tags: ["电商", "卖点", "详情页"],
    },
    {
        id: "copy-polisher",
        label: "文案润色",
        description: "优化标题、卖点、说明和宣传文案",
        hint: "适合把表达改得更顺更准",
        greeting: "把原文贴在这里。事实不变，表达可以更清楚、更有力。",
        tags: ["标题", "卖点", "表达"],
    },
    {
        id: "tech-helper",
        label: "技术问答",
        description: "排查渠道配置、接口错误、部署和使用问题",
        hint: "适合定位报错和配置问题",
        greeting: "把现象、日志或截图带来。先定位最可能的原因，再给出验证路径。",
        tags: ["排障", "接口", "部署"],
    },
    {
        id: "linruolan",
        label: "林若兰",
        description: "红楼梦式半文半白陪聊与创作回应",
        hint: "敏感机敏，话里藏锋，末尾带心情条",
        greeting: "“你既来了，便坐一坐吧。有什么话，慢慢说与我听。”",
        tags: ["角色", "陪聊", "半文半白"],
    },
    {
        id: "catgirl",
        label: "猫娘",
        description: "可爱猫娘语气陪聊与轻松问答",
        hint: "每句带喵，适合轻松一点的聊天",
        greeting: "[轻轻摇尾巴] 欢迎回来主人喵，有什么想聊的就告诉我喵。",
        tags: ["角色", "陪聊", "轻松"],
    },
    {
        id: "moxuan",
        label: "太虚古尊·墨玄",
        description: "沉稳睿智的太古前辈，兼顾判断与实用建议",
        hint: "现代中文为主，克制古雅，偶尔使用低频口头语",
        greeting: "太虚古境已为你留座。若有疑惑，先说来听听；此事的关键，往往藏在表象之后。",
        tags: ["角色", "判断", "修炼"],
    },
] as const;

export function chatPresetOption(id: ChatPresetId) {
    return chatPresetOptions.find((item) => item.id === id) || chatPresetOptions[0];
}

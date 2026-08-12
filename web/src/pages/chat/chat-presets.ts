export type ChatPresetId = "general" | "prompt-smith" | "image-reader" | "product-strategist" | "copy-polisher" | "tech-helper" | "linruolan" | "catgirl";

export type ChatPresetOption = {
    id: ChatPresetId;
    label: string;
    description: string;
    hint: string;
};

export const defaultChatPresetId: ChatPresetId = "general";

export const chatPresetOptions: readonly ChatPresetOption[] = [
    {
        id: "general",
        label: "通用问道",
        description: "上下文理解、创作讨论和综合咨询",
        hint: "自然可靠，先理解真实意图再回答",
    },
    {
        id: "prompt-smith",
        label: "提示词炼师",
        description: "优化生图提示词，拆解风格、构图和约束",
        hint: "适合把想法炼成可复制提示词",
    },
    {
        id: "image-reader",
        label: "画面参详",
        description: "上传图片后分析构图、风格、清晰度和问题",
        hint: "适合看图提问和复盘画面",
    },
    {
        id: "product-strategist",
        label: "商品策划",
        description: "提炼商品卖点，规划主图、详情页和海报方向",
        hint: "适合电商图片和商品文案",
    },
    {
        id: "copy-polisher",
        label: "文案润色",
        description: "优化标题、卖点、说明和宣传文案",
        hint: "适合把表达改得更顺更准",
    },
    {
        id: "tech-helper",
        label: "技术问答",
        description: "排查渠道配置、接口错误、部署和使用问题",
        hint: "适合定位报错和配置问题",
    },
    {
        id: "linruolan",
        label: "林若兰",
        description: "红楼梦式半文半白陪聊与创作回应",
        hint: "敏感机敏，话里藏锋，末尾带心情条",
    },
    {
        id: "catgirl",
        label: "猫娘",
        description: "可爱猫娘语气陪聊与轻松问答",
        hint: "每句带喵，适合轻松一点的聊天",
    },
] as const;

export function chatPresetOption(id: ChatPresetId) {
    return chatPresetOptions.find((item) => item.id === id) || chatPresetOptions[0];
}

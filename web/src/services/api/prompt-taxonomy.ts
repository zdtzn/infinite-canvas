export const PROMPT_TAXONOMY = [
    "人物人像",
    "动漫插画",
    "摄影写实",
    "国风东方",
    "商品商业",
    "平面设计",
    "建筑空间",
    "自然风景",
    "3D 创意",
    "图像编辑",
    "创意灵感",
] as const;

export type PromptTaxonomyTag = (typeof PROMPT_TAXONOMY)[number];

type PromptTaxonomyInput = {
    title: string;
    prompt: string;
    tags: readonly string[];
};

type TaxonomyRule = {
    tag: Exclude<PromptTaxonomyTag, "创意灵感">;
    keywords: readonly string[];
};

const TAXONOMY_RULES: readonly TaxonomyRule[] = [
    {
        tag: "商品商业",
        keywords: ["商品", "电商", "主图", "详情页", "产品摄影", "产品展示", "商业广告", "包装展示", "ecommerce", "e-commerce", "product shot", "product photography", "advertising", "commercial", "packaging", "retail"],
    },
    {
        tag: "平面设计",
        keywords: ["海报", "排版", "字体设计", "信息图", "标志", "品牌", "包装设计", "菜单", "名片", "封面", "图标", "界面", "poster", "typography", "infographic", "logo", "branding", "graphic design", "editorial", "magazine cover", "album cover", "icon", "ui design"],
    },
    {
        tag: "国风东方",
        keywords: ["国风", "中国风", "东方美学", "水墨", "山水", "古风", "汉服", "武侠", "仙侠", "敦煌", "宋代", "唐代", "明代", "清代", "ink wash", "chinese style", "oriental", "hanfu", "wuxia", "xianxia"],
    },
    {
        tag: "动漫插画",
        keywords: ["动漫", "二次元", "插画", "绘本", "漫画", "卡通", "概念艺术", "水彩", "油画", "anime", "manga", "illustration", "comic", "cartoon", "concept art", "watercolor", "oil painting"],
    },
    {
        tag: "人物人像",
        keywords: ["人像", "肖像", "头像", "人物", "模特", "写真", "证件照", "自拍", "portrait", "headshot", "fashion model", "selfie", "character portrait"],
    },
    {
        tag: "建筑空间",
        keywords: ["建筑", "室内", "家居", "空间设计", "城市景观", "房间", "店铺", "家具", "architecture", "architectural", "interior", "room", "furniture", "urban", "building"],
    },
    {
        tag: "自然风景",
        keywords: ["风景", "自然", "山川", "海洋", "森林", "天空", "花卉", "植物", "动物", "野生", "landscape", "nature", "mountain", "ocean", "forest", "sky", "botanical", "wildlife", "animal"],
    },
    {
        tag: "3D 创意",
        keywords: ["三维", "黏土", "粘土", "微缩", "等距", "玩具", "手办", "立体", "场景模型", "3d", "clay", "miniature", "isometric", "render", "blender", "figurine", "toy", "diorama"],
    },
    {
        tag: "图像编辑",
        keywords: ["需要参考图", "参考图", "图生图", "局部重绘", "换装", "换背景", "扩图", "修复照片", "移除背景", "替换背景", "保持人物", "needs_ref", "image edit", "image-to-image", "inpainting", "outpainting", "remove background", "reference image", "face swap", "style transfer"],
    },
    {
        tag: "摄影写实",
        keywords: ["摄影", "写实", "纪实", "胶片", "电影感", "摄影棚", "棚拍", "photo", "photography", "photorealistic", "cinematic", "film still", "documentary", "studio lighting"],
    },
];

const englishKeywordPattern = /^[a-z0-9][a-z0-9 -]*$/i;
const taxonomyTags = new Set<string>(PROMPT_TAXONOMY);

function includesKeyword(value: string, keyword: string) {
    if (!englishKeywordPattern.test(keyword)) return value.includes(keyword);
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(value);
}

export function isPromptTaxonomyTag(value: string): value is PromptTaxonomyTag {
    return taxonomyTags.has(value);
}

/** Convert arbitrary repository metadata into one stable, user-facing primary theme. */
export function classifyPromptTags(input: PromptTaxonomyInput): PromptTaxonomyTag[] {
    const existing = input.tags.find(isPromptTaxonomyTag);
    if (existing) return [existing];
    const prominentText = [input.title, ...input.tags].join(" ").toLowerCase();
    const fullText = `${prominentText} ${input.prompt}`.toLowerCase();
    const scored = TAXONOMY_RULES.map((rule, index) => {
        const prominentMatches = rule.keywords.filter((keyword) => includesKeyword(prominentText, keyword)).length;
        const bodyMatches = rule.keywords.filter((keyword) => includesKeyword(fullText, keyword)).length;
        return { tag: rule.tag, score: prominentMatches * 3 + bodyMatches, index };
    })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index);

    return [scored[0]?.tag || "创意灵感"];
}

export function sortPromptTaxonomyTags(tags: readonly string[]) {
    const order = new Map(PROMPT_TAXONOMY.map((tag, index) => [tag, index]));
    return [...tags].sort((left, right) => (order.get(left as PromptTaxonomyTag) ?? Number.MAX_SAFE_INTEGER) - (order.get(right as PromptTaxonomyTag) ?? Number.MAX_SAFE_INTEGER));
}

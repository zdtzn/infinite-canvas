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

export const PROMPT_TAXONOMY_REVISION = "single-theme-v2";
export type PromptTaxonomyTag = (typeof PROMPT_TAXONOMY)[number];

type PromptTaxonomyInput = {
    title: string;
    prompt: string;
    tags: readonly string[];
    previousTheme?: PromptTaxonomyTag;
};

type TaxonomyRule = {
    tag: Exclude<PromptTaxonomyTag, "创意灵感">;
    keywords: readonly string[];
};

const TAXONOMY_RULES: readonly TaxonomyRule[] = [
    {
        tag: "商品商业",
        keywords: ["商品", "电商", "主图", "详情页", "产品摄影", "产品展示", "广告", "包装展示", "珐琅别针", "ecommerce", "e-commerce", "product shot", "product photography", "advertising", "commercial", "packaging", "retail"],
    },
    {
        tag: "平面设计",
        keywords: ["海报", "排版", "字体设计", "信息图", "流程图", "文档设计", "标志", "标志设计", "品牌", "包装设计", "菜单", "名片", "封面", "图标", "界面", "poster", "typography", "infographic", "flowchart", "logo", "logo design", "design a logo", "branding", "graphic design", "editorial", "magazine cover", "album cover", "icon", "app icon", "ui design"],
    },
    {
        tag: "国风东方",
        keywords: ["国风", "中国风", "东方美学", "水墨", "山水", "古风", "汉服", "武侠", "仙侠", "敦煌", "宋代", "唐代", "明代", "清代", "ink wash", "chinese style", "oriental", "hanfu", "wuxia", "xianxia"],
    },
    {
        tag: "动漫插画",
        keywords: ["动漫", "二次元", "插画", "绘本", "漫画", "卡通", "表情包", "概念艺术", "水彩", "油画", "anime", "manga", "illustration", "comic", "cartoon", "concept art", "watercolor", "oil painting"],
    },
    {
        tag: "人物人像",
        keywords: ["人像", "肖像", "自画像", "头像", "人物", "模特", "写真", "证件照", "自拍", "portrait", "headshot", "fashion model", "selfie", "self portrait", "self-portrait", "character portrait"],
    },
    {
        tag: "建筑空间",
        keywords: ["建筑", "室内", "家居", "空间设计", "城市景观", "房间", "店铺", "家具", "architecture", "architectural", "interior", "room", "furniture", "urban", "building"],
    },
    {
        tag: "自然风景",
        keywords: ["风景", "自然景观", "山川", "海洋", "森林", "天空", "花卉", "植物", "动物", "野生", "宠物", "小猫", "小狗", "landscape", "nature", "mountain", "ocean", "forest", "sky", "botanical", "wildlife", "animal", "pet", "puppy", "kitten"],
    },
    {
        tag: "3D 创意",
        keywords: ["三维", "黏土", "粘土", "微缩", "等距", "玩具", "手办", "立体", "场景模型", "3d", "clay", "miniature", "isometric", "render", "blender", "figurine", "toy", "diorama"],
    },
    {
        tag: "图像编辑",
        keywords: ["图像编辑", "图生图", "局部重绘", "换装", "换背景", "扩图", "抠图", "修复照片", "移除背景", "去除背景", "替换背景", "提取主体", "提高分辨率", "提升分辨率", "姿势替换", "姿势参考替换", "替换姿势", "换姿势", "换脸", "上色与翻译", "漫画页面上色", "image edit", "image-to-image", "inpainting", "outpainting", "remove background", "remove the background", "replace background", "replace the background", "change the background", "face swap", "style transfer"],
    },
    {
        tag: "摄影写实",
        keywords: ["摄影", "写实", "纪实", "胶片", "电影感", "摄影棚", "棚拍", "photo", "photography", "photorealistic", "cinematic", "film still", "documentary", "studio lighting"],
    },
];

const taxonomyTags = new Set<string>(PROMPT_TAXONOMY);
const taxonomyOrder = new Map(PROMPT_TAXONOMY.map((tag, index) => [tag, index]));
const curatedSourceThemes = new Map<string, PromptTaxonomyTag>([
    ["产品展示图", "商品商业"],
    ["广告设计", "商品商业"],
    ["3d/手办/潮玩", "3D 创意"],
]);
const incidentalTerms = new Set(["品牌", "标志", "图标", "logo", "branding", "icon", "render"]);
const rules = TAXONOMY_RULES.map(({ tag, keywords }) => ({
    tag,
    matches: keywords.map((keyword) => ({
        keyword,
        pattern: /^[a-z0-9][a-z0-9 -]*$/i.test(keyword) ? new RegExp(`(?:^|[^a-z0-9])${keyword.replace(/ +/g, "\\s+")}(?=$|[^a-z0-9])`) : null,
    })),
}));
const editRule = rules.find(({ tag }) => tag === "图像编辑")!;

export function isPromptTaxonomyTag(value: string): value is PromptTaxonomyTag {
    return taxonomyTags.has(value);
}

export function classifyPromptTags(input: PromptTaxonomyInput): PromptTaxonomyTag[] {
    const existing = input.tags.find(isPromptTaxonomyTag);
    if (existing) return [existing];

    const title = positiveText(input.title);
    if (countMatches(editRule, title)) return [editRule.tag];

    const sourceTags = input.tags.map((tag) => tag.normalize("NFKC").toLowerCase().trim());
    const sourceTheme = sourceTags.map((tag) => curatedSourceThemes.get(tag)).find(Boolean);
    if (sourceTheme) return [sourceTheme];
    // Some source parsers split the complete category at slashes.
    if (["3d", "手办", "潮玩"].every((tag) => sourceTags.includes(tag))) return ["3D 创意"];

    // Match the main title before inferring a theme from other metadata and scene details.
    const theme = bestTheme(title) || bestTheme(sourceTags.join(" "));
    if (theme) return [theme];

    const body = positiveText(input.prompt);
    if (countMatches(editRule, body)) return [editRule.tag];
    return [bestTheme(body, true) || input.previousTheme || "创意灵感"];
}

function positiveText(value: string) {
    return value.normalize("NFKC").toLowerCase()
        .replace(/(?:^|\n)[ \t]*(?:negative prompt|负面提示词|反向提示词)[ \t]*:[\s\S]*?(?=\n[ \t]*(?:positive prompt|正向提示词)[ \t]*:|$)/g, " ")
        .replace(/(?:\b(?:no|without|avoid|exclude|do not|don't)\b[ \t]+|不要|避免|禁止|不含|不添加|没有|无(?=水印|品牌|标志|logo|文字))[^。；;.!?\n]*/g, " ");
}

function countMatches(rule: typeof rules[number], value: string, body = false) {
    let score = 0;
    for (const { keyword, pattern } of rule.matches) {
        const incidental = incidentalTerms.has(keyword);
        if ((body && incidental) || !(pattern ? pattern.test(value) : value.includes(keyword))) continue;
        score += incidental ? 0.25 : 1;
    }
    return score;
}

function bestTheme(value: string, body = false) {
    // Background descriptions are weak evidence when the prompt lacks a useful title or tags.
    const subject = body ? value.replace(/(?:背景(?:中)?(?::|是|为|有)|\b(?:in|for) the background\b|(?:^|[.；;\n])[ \t]*background[ \t]*:)[^。；;.!?\n]*/g, " ") : value;
    let score = 0;
    let theme: PromptTaxonomyTag | undefined;
    for (const rule of rules) {
        const matches = countMatches(rule, subject, body);
        if (matches <= score) continue;
        score = matches;
        theme = rule.tag;
    }
    return theme;
}

export function sortPromptTaxonomyTags(tags: readonly string[]) {
    return [...tags].sort((left, right) => (taxonomyOrder.get(left as PromptTaxonomyTag) ?? Number.MAX_SAFE_INTEGER) - (taxonomyOrder.get(right as PromptTaxonomyTag) ?? Number.MAX_SAFE_INTEGER));
}

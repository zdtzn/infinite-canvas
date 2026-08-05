export type ProductOutputKind = "basic_image" | "main_image" | "detail_page" | "selling_poster" | "scene_image";
export type ProductPlanPreset = "single" | "essential" | "full";

export type ProductSectionType = "basic" | "hero" | "selling_points" | "scenario" | "detail_closeup" | "specs" | "material" | "comparison" | "brand_trust" | "summary" | "custom";

export type ProductVisualStyleGuide = {
    styleName: string;
    colorPalette: string;
    backgroundSystem: string;
    lighting: string;
    cameraLanguage: string;
    typography: string;
    layoutRules: string;
    propRules: string;
    productRenderingRules: string;
    negativeStyleConstraints: string;
};

export type ProductDetailSection = {
    type: ProductSectionType;
    title: string;
    objective: string;
    copy: string;
    prompt: string;
    negativeConstraints: string[];
};

export type ProductAnalysis = {
    productName: string;
    category: string;
    subcategory: string;
    material: string;
    color: string;
    styleTags: string[];
    targetAudience: string;
    usageScenarios: string[];
    titleSuggestion: string;
    sellingPoints: string[];
    differentiationPoints: string[];
    userConcerns: string[];
    recommendedFocusPoints: string[];
    additionalInformation: string;
    visualDirection: string;
    visualStyleGuide: ProductVisualStyleGuide;
    complianceNotes: string[];
    detailSections: ProductDetailSection[];
};

export type ProductPlanItem = {
    id: string;
    kind: ProductOutputKind;
    sectionType: ProductSectionType;
    styleKey: string;
    title: string;
    description: string;
    copy: string;
    prompt: string;
    negativeConstraints: string[];
    aspectRatio: string;
    pageIndex: number;
};

export const productStyleOptions = [
    { value: "clean", label: "品牌清透", description: "柔和品牌色与空间层次，不使用整套纯白底" },
    { value: "lifestyle", label: "生活场景", description: "自然融入真实使用环境" },
    { value: "value", label: "卖点强化", description: "聚焦转化与核心利益点" },
    { value: "premium", label: "品质质感", description: "强调材质、细节与光影" },
] as const;

export const productOutputDefinitions = [
    { kind: "basic_image", label: "基础商品图", capability: "product.basic", description: "整理商品主体、光线与中性背景", requiresAnalysis: false },
    { kind: "main_image", label: "商品主图", capability: "product.main_image", description: "建立第一眼商品识别与购买理由", requiresAnalysis: false },
    { kind: "selling_poster", label: "卖点海报", capability: "product.analysis", description: "围绕一个真实卖点建立信息层级", requiresAnalysis: true },
    { kind: "scene_image", label: "商品场景图", capability: "product.main_image", description: "将商品自然放入真实使用环境", requiresAnalysis: false },
    { kind: "detail_page", label: "详情页", capability: "product.detail_page", description: "按页展开卖点、场景、细节与规格", requiresAnalysis: true },
] as const satisfies ReadonlyArray<{ kind: ProductOutputKind; label: string; capability: string; description: string; requiresAnalysis: boolean }>;

const EMPTY_VISUAL_STYLE_GUIDE: ProductVisualStyleGuide = {
    styleName: "",
    colorPalette: "",
    backgroundSystem: "",
    lighting: "",
    cameraLanguage: "",
    typography: "",
    layoutRules: "",
    propRules: "",
    productRenderingRules: "",
    negativeStyleConstraints: "",
};

const SECTION_TYPE_LABELS: Record<ProductSectionType, string> = {
    basic: "基础商品视觉",
    hero: "头图主视觉",
    selling_points: "核心卖点",
    scenario: "使用场景",
    detail_closeup: "细节特写",
    specs: "规格结构",
    material: "材质工艺",
    comparison: "选择理由",
    brand_trust: "品质信任",
    summary: "总结收口",
    custom: "自定义页面",
};

export function productSectionTypeLabel(type: ProductSectionType) {
    return SECTION_TYPE_LABELS[type] || SECTION_TYPE_LABELS.custom;
}

export function productRealmExperience(realmName: string) {
    const realm = realmName.trim();
    const experiences: Record<string, { title: string; description: string }> = {
        斗之气: { title: "欢迎踏入商品炼制之道。", description: "当前可感悟基础商品创作法则。" },
        斗者: { title: "欢迎道友。", description: "已掌握基础商品画卷之术。" },
        斗师: { title: "商品灵韵已可解析。", description: "可以识别商品并凝练基础卖点。" },
        大斗师: { title: "已掌握商品视觉塑造之法。", description: "可以开始构建基础详情画卷。" },
        斗灵: { title: "商品意境开始显现。", description: "完整详情页已可逐页展开。" },
        斗王: { title: "天地创意之力已可调动。", description: "同一商品可以探索多种视觉方向。" },
        斗皇: { title: "商品之意皆可解析。", description: "标题、卖点与视觉方向将形成统一规划。" },
        斗宗: { title: "空间展开。", description: "多个商品项目可以有序规划与炼制。" },
        斗尊: { title: "商品视觉法则已然清晰。", description: "品牌信息可以贯穿整套商品画卷。" },
        斗尊巅峰: { title: "商品视觉法则已臻化境。", description: "整套视觉能够保持稳定而统一的表达。" },
        半圣: { title: "圣境商品领域已近在眼前。", description: "完整商业视觉正在形成一体化秩序。" },
        斗圣: { title: "一念之间，可构建完整商品体系。", description: "分析、规划与成套视觉皆已贯通。" },
        斗帝: { title: "恭迎斗帝归来。", description: "天地法则已感知您的创造之意。商品万象，皆可化为画卷。" },
    };
    const experience = experiences[realm] || experiences["斗之气"];
    const imperial = realm === "斗帝";
    return { ...experience, imperial, actionLabel: imperial ? "一念成卷" : "凝聚商品画卷" };
}

export function productDetailPageLimit(realmName: string) {
    const realmOrder = ["斗之气", "斗者", "斗师", "大斗师", "斗灵", "斗王", "斗皇", "斗宗", "斗尊", "斗尊巅峰", "半圣", "斗圣", "斗帝"];
    const index = realmOrder.indexOf(realmName.trim());
    if (index < realmOrder.indexOf("大斗师")) return 0;
    return index === realmOrder.indexOf("大斗师") ? 3 : 8;
}

export function availableProductOutputs(input: { capabilities: string[]; imageModelAvailable: boolean; analysisAvailable: boolean }) {
    const granted = new Set(input.capabilities);
    return productOutputDefinitions.map((definition) => {
        const capabilityAvailable = granted.has(definition.capability);
        const analysisReady = !definition.requiresAnalysis || input.analysisAvailable;
        const available = input.imageModelAvailable && capabilityAvailable && analysisReady;
        const reason = !input.imageModelAvailable ? "管理员尚未开放可用的生图模型" : !capabilityAvailable ? "当前境界尚不足以开启此项商品法则。继续修炼即可掌握。" : !analysisReady ? "管理员尚未配置可识别商品图片的文本模型" : "";
        return { ...definition, available, reason };
    });
}

export function buildProductVisualStyleGuide(analysis: ProductAnalysis, styleKey: string, brandName = "") {
    const preset = stylePreset(styleKey);
    const generated = analysis.visualStyleGuide || EMPTY_VISUAL_STYLE_GUIDE;
    const brand = brandName.trim();
    return {
        styleName: `${brand ? `${brand} ` : ""}${preset.styleName}${generated.styleName.trim() ? ` · ${generated.styleName.trim()}` : ""}`,
        colorPalette: combineVisualRule(preset.colorPalette, generated.colorPalette),
        backgroundSystem: `${combineVisualRule(preset.backgroundSystem, generated.backgroundSystem)}。除基础商品图外，不得连续使用纯白无影棚、空白画布或仅有商品抠图的背景；每页必须有明确的色彩层次、材质承托或真实环境。`,
        lighting: combineVisualRule(preset.lighting, generated.lighting),
        cameraLanguage: combineVisualRule(preset.cameraLanguage, generated.cameraLanguage),
        typography: combineVisualRule(preset.typography, generated.typography),
        layoutRules: combineVisualRule(preset.layoutRules, generated.layoutRules),
        propRules: combineVisualRule(preset.propRules, generated.propRules),
        productRenderingRules: combineVisualRule("参考图是商品身份唯一事实来源，保持品类、轮廓、比例、颜色、材质、开口、按键、线缆、包装文字与 Logo 一致", generated.productRenderingRules),
        negativeStyleConstraints: combineVisualRule("禁止整套纯白底、空模板、伪文字、错误结构、悬浮商品、断裂阴影、无关道具和无法证实的规格或功效", generated.negativeStyleConstraints),
    } satisfies ProductVisualStyleGuide;
}

function combineVisualRule(primary: string, secondary: string) {
    const extra = secondary.trim();
    return extra && !primary.includes(extra) ? `${primary}；商品分析补充：${extra}` : primary;
}

export function buildProductVisualPlan(input: { analysis: ProductAnalysis; platform: string; styleKey: string; brandName: string; detailPageLimit: number }) {
    const analysis = planningAnalysis(input.analysis);
    const productName = analysis.productName.trim() || "商品";
    const sellingPoints = analysis.sellingPoints.filter(Boolean);
    const primarySellingPoint = sellingPoints[0] || "清晰呈现商品真实特点";
    const style = productStyleOptions.find((item) => item.value === input.styleKey) || productStyleOptions[0];
    const guide = buildProductVisualStyleGuide(analysis, style.value, input.brandName);
    const items: ProductPlanItem[] = [
        createPlanItem({
            id: "basic-image",
            kind: "basic_image",
            sectionType: "basic",
            styleKey: style.value,
            title: "基础商品图",
            description: "整理主体、光线与中性背景",
            copy: "完整、真实地展示商品本身",
            aspectRatio: "1:1",
            pageIndex: 0,
            analysis,
            guide,
            platform: input.platform,
            brandName: input.brandName,
            localDirection: "使用浅灰、浅品牌色或真实材质台面构成中性摄影环境，商品完整清晰并保留自然接触阴影。不得使用刺眼纯白空底，也不得添加营销信息。",
            negativeConstraints: ["不改变商品结构", "不添加不存在的配件", "不使用刺眼纯白空底"],
        }),
        createPlanItem({
            id: "main-image",
            kind: "main_image",
            sectionType: "hero",
            styleKey: style.value,
            title: "拼多多商品主图",
            description: analysis.titleSuggestion || "第一眼识别商品与核心购买理由",
            copy: `${analysis.titleSuggestion || productName}；${primarySellingPoint}`,
            aspectRatio: "1:1",
            pageIndex: 0,
            analysis,
            guide,
            platform: input.platform,
            brandName: input.brandName,
            localDirection: `商品以三分之四角度或最能说明结构的角度成为绝对主体，占画面约 55%-68%；用品牌色层次、材质承托面或轻场景建立完整主视觉，突出“${primarySellingPoint}”。标题与 1-2 个已确认卖点形成清晰层级。`,
            negativeConstraints: ["不得保留参考图原始白底", "不得输出空白商品抠图", "不得使用未经确认的价格、优惠或功效"],
        }),
        createPlanItem({
            id: "selling-poster",
            kind: "selling_poster",
            sectionType: "selling_points",
            styleKey: style.value,
            title: "核心卖点海报",
            description: primarySellingPoint,
            copy: primarySellingPoint,
            aspectRatio: "3:4",
            pageIndex: 0,
            analysis,
            guide,
            platform: input.platform,
            brandName: input.brandName,
            localDirection: `围绕“${primarySellingPoint}”建立单一信息核心。使用产品近景、真实部件指示或材质细节作为证据，搭配明确的标题区和短卖点区；背景采用与主图一致的品牌色系统，但构图更有纵向节奏。`,
            negativeConstraints: ["不得使用与卖点无关的装饰", "标注线不得指向错误部件", "不得生成无法确认的绝对化承诺"],
        }),
        createPlanItem({
            id: "scene-image",
            kind: "scene_image",
            sectionType: "scenario",
            styleKey: style.value,
            title: "真实使用场景",
            description: analysis.usageScenarios[0] || "呈现商品进入用户生活后的状态",
            copy: analysis.usageScenarios[0] || "真实场景，自然使用",
            aspectRatio: "4:3",
            pageIndex: 0,
            analysis,
            guide,
            platform: input.platform,
            brandName: input.brandName,
            localDirection: `将商品放入“${analysis.usageScenarios[0] || "符合商品品类的真实使用环境"}”，环境必须说明商品如何被使用。使用 2-4 个相关道具建立生活情境，商品仍是画面主角，光线、接触阴影、手部动作和使用方向符合真实物理逻辑。`,
            negativeConstraints: ["不得保留摄影棚白底", "不得让环境遮挡商品关键结构", "不得出现错误使用方式或无关道具"],
        }),
    ];

    const sections = resolveDetailSections(analysis, input.detailPageLimit);
    sections.forEach((section, index) => {
        items.push(
            createPlanItem({
                id: `detail-${index + 1}`,
                kind: "detail_page",
                sectionType: section.type || "custom",
                styleKey: style.value,
                title: section.title || `详情页 ${index + 1}`,
                description: section.objective || "逐页展开商品信息",
                copy: section.copy || section.objective || section.title,
                aspectRatio: "3:4",
                pageIndex: index,
                analysis,
                guide,
                platform: input.platform,
                brandName: input.brandName,
                localDirection: `${section.prompt}。本页只承担“${section.objective || section.title}”这一项沟通任务。${sectionBackgroundInstruction(section.type, analysis)}`,
                negativeConstraints: section.negativeConstraints,
            }),
        );
    });
    return items;
}

function planningAnalysis(value: ProductAnalysis): ProductAnalysis {
    const empty = emptyProductAnalysis(value?.productName || "");
    return {
        ...empty,
        ...value,
        styleTags: Array.isArray(value?.styleTags) ? value.styleTags : [],
        usageScenarios: Array.isArray(value?.usageScenarios) ? value.usageScenarios : [],
        sellingPoints: Array.isArray(value?.sellingPoints) ? value.sellingPoints : [],
        differentiationPoints: Array.isArray(value?.differentiationPoints) ? value.differentiationPoints : [],
        userConcerns: Array.isArray(value?.userConcerns) ? value.userConcerns : [],
        recommendedFocusPoints: Array.isArray(value?.recommendedFocusPoints) ? value.recommendedFocusPoints : [],
        complianceNotes: Array.isArray(value?.complianceNotes) ? value.complianceNotes : [],
        visualStyleGuide: value?.visualStyleGuide || empty.visualStyleGuide,
        detailSections: Array.isArray(value?.detailSections)
            ? value.detailSections.map((section) => ({
                  type: section.type || "custom",
                  title: section.title || "",
                  objective: section.objective || "",
                  copy: section.copy || section.objective || section.title || "",
                  prompt: section.prompt || "",
                  negativeConstraints: Array.isArray(section.negativeConstraints) ? section.negativeConstraints : [],
              }))
            : [],
    };
}

export function buildMultiStyleProductPlan(input: { analysis: ProductAnalysis; platform: string; styleKeys: string[]; brandName: string; detailPageLimit: number }) {
    const styleKeys = Array.from(new Set(input.styleKeys.filter(Boolean))).slice(0, 3);
    const activeStyles = styleKeys.length ? styleKeys : ["clean"];
    return activeStyles.flatMap((styleKey) => {
        const style = productStyleOptions.find((item) => item.value === styleKey) || productStyleOptions[0];
        return buildProductVisualPlan({ ...input, styleKey }).map((item) => ({
            ...item,
            id: `${style.value}:${item.id}`,
            title: activeStyles.length > 1 ? `${item.title} · ${style.label}` : item.title,
        }));
    });
}

export function reconcileProductPlanSelection(current: readonly string[], plan: readonly ProductPlanItem[]) {
    const availableIds = new Set(plan.map((item) => item.id));
    const valid = current.filter((id) => availableIds.has(id));
    if (valid.length) return Array.from(new Set(valid));
    const preferred = plan.find((item) => item.kind === "main_image") || plan[0];
    return preferred ? [preferred.id] : [];
}

export function productPlanPresetSelection(preset: ProductPlanPreset, plan: readonly ProductPlanItem[]) {
    if (!plan.length) return [];
    const preferred = plan.find((item) => item.kind === "main_image") || plan.find((item) => item.kind === "basic_image") || plan[0];
    const primaryStylePlan = plan.filter((item) => item.styleKey === preferred.styleKey);
    if (preset === "single") return [preferred.id];
    if (preset === "full") return primaryStylePlan.slice(0, 12).map((item) => item.id);

    const selected = (["main_image", "selling_poster", "scene_image"] as const).map((kind) => primaryStylePlan.find((item) => item.kind === kind)?.id).filter((id): id is string => Boolean(id));
    return selected.length ? selected : [preferred.id];
}

export function productPlanVisualControls(mode: ProductPlanPreset | "custom", selectedKinds: readonly ProductOutputKind[]) {
    const singleOutput = mode === "single" || (mode === "custom" && new Set(selectedKinds).size === 1);
    return singleOutput
        ? {
              styleLabel: "主图视觉风格",
              styleHint: "选择一张图的主要视觉表达",
              showTemplates: true,
          }
        : {
              styleLabel: "整套视觉基调",
              styleHint: "统一主图、卖点图与场景图的色彩和质感",
              showTemplates: false,
          };
}

export function toggleProductPlanItemSelection(current: readonly string[], itemId: string) {
    return current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
}

export function toggleProductPlanKindSelection(current: readonly string[], plan: readonly ProductPlanItem[], kind: ProductOutputKind) {
    const kindIds = plan.filter((item) => item.kind === kind).map((item) => item.id);
    if (!kindIds.length) return [...current];
    const currentSet = new Set(current);
    const allSelected = kindIds.every((id) => currentSet.has(id));
    if (allSelected) return current.filter((id) => !kindIds.includes(id));
    return Array.from(new Set([...current, ...kindIds]));
}

export function selectedProductOutputKinds(selectedPlanIds: readonly string[], plan: readonly ProductPlanItem[]) {
    const selected = new Set(selectedPlanIds);
    return Array.from(new Set(plan.filter((item) => selected.has(item.id)).map((item) => item.kind)));
}

export function resolveProductTemplatePrompt(promptTemplate: string, productName: string) {
    const resolvedName = productName.trim() || "当前商品";
    return promptTemplate.replace(/\{\{productName\}\}/g, resolvedName);
}

export function emptyProductAnalysis(productName = ""): ProductAnalysis {
    return {
        productName,
        category: "",
        subcategory: "",
        material: "",
        color: "",
        styleTags: [],
        targetAudience: "",
        usageScenarios: [],
        titleSuggestion: "",
        sellingPoints: [],
        differentiationPoints: [],
        userConcerns: [],
        recommendedFocusPoints: [],
        additionalInformation: "",
        visualDirection: "",
        visualStyleGuide: { ...EMPTY_VISUAL_STYLE_GUIDE },
        complianceNotes: [],
        detailSections: [],
    };
}

function createPlanItem(input: {
    id: string;
    kind: ProductOutputKind;
    sectionType: ProductSectionType;
    styleKey: string;
    title: string;
    description: string;
    copy: string;
    aspectRatio: string;
    pageIndex: number;
    analysis: ProductAnalysis;
    guide: ProductVisualStyleGuide;
    platform: string;
    brandName: string;
    localDirection: string;
    negativeConstraints: string[];
}): ProductPlanItem {
    const productName = input.analysis.productName.trim() || "商品";
    const facts = [
        input.analysis.category && `品类：${input.analysis.category}`,
        input.analysis.subcategory && `细分类：${input.analysis.subcategory}`,
        input.analysis.material && `材质：${input.analysis.material}`,
        input.analysis.color && `固有颜色：${input.analysis.color}`,
        input.analysis.sellingPoints.length && `已确认卖点：${input.analysis.sellingPoints.slice(0, 5).join("、")}`,
        input.analysis.differentiationPoints.length && `可确认差异点：${input.analysis.differentiationPoints.slice(0, 4).join("、")}`,
        input.analysis.recommendedFocusPoints.length && `建议视觉证据：${input.analysis.recommendedFocusPoints.slice(0, 4).join("、")}`,
        input.analysis.userConcerns.length && `用户顾虑：${input.analysis.userConcerns.slice(0, 4).join("、")}`,
        input.analysis.additionalInformation && `结构与使用事实：${input.analysis.additionalInformation}`,
    ]
        .filter(Boolean)
        .join("；");
    const negative = Array.from(
        new Set(
            [
                ...input.negativeConstraints,
                ...input.analysis.complianceNotes,
                input.guide.negativeStyleConstraints,
                "不得改变商品品类、几何结构、颜色、材质、开口、按钮、线缆、包装文字或 Logo",
                "不得出现悬浮、穿模、断裂阴影、错误反射、反向气流、液体逆流或不合理手部动作",
            ].filter(Boolean),
        ),
    );
    const prompt = [
        `为${platformLabel(input.platform)}生成一张完成度高的${productSectionTypeLabel(input.sectionType)}。`,
        `商品：${productName}。${truncatePromptText(facts, 4_500)}`,
        `页面目标：${input.description}。画内核心文案：${input.copy || input.title}。`,
        `整体视觉方向：${truncatePromptText(input.analysis.visualDirection || input.guide.styleName, 1_000)}。`,
        `局部画面要求：${truncatePromptText(input.localDirection, 2_500)}`,
        `统一视觉系统：风格“${truncatePromptText(input.guide.styleName, 300)}”；色彩“${truncatePromptText(input.guide.colorPalette, 700)}”；背景“${truncatePromptText(input.guide.backgroundSystem, 900)}”；光线“${truncatePromptText(input.guide.lighting, 700)}”；镜头“${truncatePromptText(input.guide.cameraLanguage, 700)}”；排版“${truncatePromptText(input.guide.typography, 700)}”；布局“${truncatePromptText(input.guide.layoutRules, 700)}”；道具“${truncatePromptText(input.guide.propRules, 700)}”。`,
        `商品还原规则：${truncatePromptText(input.guide.productRenderingRules, 1_200)}${input.brandName.trim() ? `；品牌信息仅使用“${input.brandName.trim()}”` : ""}。`,
        input.kind === "basic_image"
            ? "参考图仅用于锁定商品身份；允许重新整理背景与光线，但保持完整商品展示。"
            : "参考图仅用于锁定商品身份。必须替换参考图中的原始白底、灰底或摄影棚背景，重新构建与本页目标匹配的商业场景、材质空间或品牌色背景，不得输出商品抠图加纯白背景。",
        "画面必须有清晰的前景主体、中景信息层和背景空间；商品有真实承托面、接触阴影、环境反射与景深。需要文字时只使用已确认的简体中文短标题和卖点，不生成随机伪文字、价格或优惠信息。",
        `禁止：${truncatePromptText(negative.join("；"), 3_500)}。`,
        "输出可直接使用的成品电商视觉，不是空模板、线框稿、单纯白底图或等待后期排版的半成品。",
    ].join("\n");
    return {
        id: input.id,
        kind: input.kind,
        sectionType: input.sectionType,
        styleKey: input.styleKey,
        title: input.title,
        description: input.description,
        copy: input.copy,
        prompt: limitProductPrompt(prompt),
        negativeConstraints: negative,
        aspectRatio: input.aspectRatio,
        pageIndex: input.pageIndex,
    };
}

function resolveDetailSections(analysis: ProductAnalysis, limit: number) {
    if (limit <= 0) return [];
    const sections: ProductDetailSection[] = [];
    const usedKeys = new Set<string>();
    const candidates = [...analysis.detailSections, ...fallbackDetailSections(analysis)];
    for (const section of candidates) {
        const type = section.type || "custom";
        const key = type === "custom" ? `custom:${section.title.trim().toLowerCase() || section.prompt.trim().toLowerCase()}` : type;
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        sections.push(section);
        if (sections.length >= limit) break;
    }
    return sections;
}

function truncatePromptText(value: string, maxLength: number) {
    const text = value.trim();
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function limitProductPrompt(prompt: string) {
    const maxLength = 18_000;
    if (prompt.length <= maxLength) return prompt;
    const tailLength = 2_500;
    return `${prompt.slice(0, maxLength - tailLength - 5)}\n...\n${prompt.slice(-tailLength)}`;
}

function fallbackDetailSections(analysis: ProductAnalysis): ProductDetailSection[] {
    const primarySellingPoint = analysis.sellingPoints[0] || "商品核心价值";
    const scenario = analysis.usageScenarios[0] || "符合商品品类的真实使用环境";
    const concern = analysis.userConcerns[0] || "用户最关心的使用与品质问题";
    return [
        detailSection("selling_points", "核心卖点速览", "快速讲清购买理由", `${primarySellingPoint}，一屏看懂核心价值`, "商品与 2-4 个真实卖点同屏，用部件近景或使用结果为卖点提供视觉证据", ["不得堆叠超过四个卖点"]),
        detailSection("scenario", "真实使用场景", "建立生活与使用联想", scenario, `在${scenario}中展示商品的真实使用状态，人物或手部动作自然，环境服务于功能理解`, ["不得摆拍成无使用关系的静物白底图"]),
        detailSection("detail_closeup", "关键细节特写", "呈现结构、做工与真实质感", "细节经得起放大", "使用近景或微距镜头展示商品关键部件、边缘、接缝、表面纹理与做工", ["不得虚构商品不存在的结构"]),
        detailSection("material", "材质与工艺", "解释质感和品质来源", analysis.material || "材质与工艺清晰可见", "使用材质切片、纹理近景和真实光泽表现，只说明图片或用户信息可确认的材质", ["未知材质不得自行命名"]),
        detailSection("specs", "结构与规格", "降低尺寸和适配理解成本", analysis.additionalInformation || "结构关系清晰易懂", "使用克制的信息图式构图展示外形结构、部件关系和可确认规格；未知数字不进入画面", ["不得虚构尺寸、容量、重量或功率"]),
        detailSection("comparison", "为什么更适合", "回应用户顾虑并建立选择理由", concern, `围绕“${concern}”用本品真实结构、材质或使用方式说明选择理由，不虚构竞品数据`, ["不得贬低竞品或伪造对比数据"]),
        detailSection("brand_trust", "品质与使用安心", "建立信任并减少下单顾虑", "真实信息，安心选择", "通过商品完整展示、细节一致性、包装与可确认信息建立信任，不生成不存在的认证或服务承诺", ["不得虚构认证、售后或检测标识"]),
        detailSection("summary", "购买理由总结", "完成详情页节奏收口", analysis.titleSuggestion || analysis.productName, "用完整商品、统一品牌背景和 2-3 个已确认购买理由完成收束，画面简洁但不回到纯白抠图", ["不得新增前文未出现的卖点"]),
    ];
}

function detailSection(type: ProductSectionType, title: string, objective: string, copy: string, prompt: string, negativeConstraints: string[]): ProductDetailSection {
    return { type, title, objective, copy, prompt, negativeConstraints };
}

function sectionBackgroundInstruction(type: ProductSectionType, analysis: ProductAnalysis) {
    const scenario = analysis.usageScenarios[0] || "真实使用环境";
    return (
        {
            basic: "使用中性材质台面与浅品牌色背景",
            hero: "使用品牌色空间、材质台面或轻场景建立第一屏冲击力",
            selling_points: "使用有层次的色块、部件近景和信息区构成转化型背景",
            scenario: `使用${scenario}作为完整环境，不得保留原图白底`,
            detail_closeup: "使用与商品材质呼应的微距环境、柔和渐深背景和局部景深",
            specs: "使用低饱和技术底纹、结构线和信息分区，不使用空白参数模板",
            material: "使用材质切片、纹理层与定向光形成有深度的工艺背景",
            comparison: "使用左右或上下信息分区与品牌色层次，避免虚构竞品图片",
            brand_trust: "使用稳定、克制的品牌空间和完整商品展示建立信任",
            summary: "延续整套品牌背景系统，用完整商品与购买理由完成收束",
            custom: "根据本页目标建立独立但遵守统一视觉规范的背景空间",
        } as Record<ProductSectionType, string>
    )[type || "custom"];
}

function stylePreset(styleKey: string): ProductVisualStyleGuide {
    const presets: Record<string, ProductVisualStyleGuide> = {
        clean: {
            styleName: "品牌清透商业视觉",
            colorPalette: "以商品固有色为主，搭配低饱和品牌辅助色、浅灰和少量高对比强调色",
            backgroundSystem: "浅品牌色空间、纸张或石材质感台面、轻微建筑层次与柔和渐深区域",
            lighting: "大面积柔光配合一处方向性轮廓光，阴影柔和但真实",
            cameraLanguage: "主图使用三分之四视角，详情页在中景、近景与微距之间有节奏变化",
            typography: "现代无衬线中文，标题明确、卖点短而少，信息区与商品保持安全距离",
            layoutRules: "商品占画面 45%-68%，前中后景明确，每页只承担一个信息目标",
            propRules: "仅使用与品类和使用场景直接相关的 2-4 个道具",
            productRenderingRules: "",
            negativeStyleConstraints: "",
        },
        lifestyle: {
            styleName: "真实生活方式视觉",
            colorPalette: "从商品固有色提取主色，搭配自然木色、织物色和环境中性色",
            backgroundSystem: "真实居家、办公、户外或使用空间，保留环境深度、自然材质与生活痕迹",
            lighting: "自然窗光或符合场景时间的环境光，保持真实接触阴影",
            cameraLanguage: "中景交代使用关系，辅以手部动作、局部近景和真实视线高度",
            typography: "文字嵌入环境留白或半透明信息区，不覆盖商品关键结构",
            layoutRules: "场景服务于商品，人物与道具不抢主体，每页呈现一个真实使用时刻",
            propRules: "道具必须能解释使用方式、目标人群或空间关系",
            productRenderingRules: "",
            negativeStyleConstraints: "",
        },
        value: {
            styleName: "高转化卖点视觉",
            colorPalette: "品牌主色配合高对比强调色和稳定中性色，避免廉价高饱和堆叠",
            backgroundSystem: "有深度的品牌色块、功能可视化层、部件特写和明确的信息分区",
            lighting: "商品高光清晰、结构边缘明确，局部光线服务于卖点证据",
            cameraLanguage: "主体近景、功能部件特写与结构指示交替使用",
            typography: "大标题、短卖点、少量标签，层级强但不堆字",
            layoutRules: "每页一个核心卖点，商品、证据画面与文案形成清晰阅读路径",
            propRules: "只保留能证明卖点的部件、场景或使用动作",
            productRenderingRules: "",
            negativeStyleConstraints: "",
        },
        premium: {
            styleName: "品质材质商业视觉",
            colorPalette: "商品固有色搭配深浅中性色、金属或材质本色，强调克制对比",
            backgroundSystem: "深浅渐变空间、石材或金属台面、局部暗部与精确轮廓光形成高级层次",
            lighting: "定向主光、柔和补光与轮廓光共同刻画材质，反射受控",
            cameraLanguage: "低机位主视觉、材质微距和结构近景形成专业产品摄影语言",
            typography: "标题精炼、字重克制、留白有秩序，信息区不遮挡材质细节",
            layoutRules: "构图稳定、边缘整洁、空间深度明确，细节页强调材质证据",
            propRules: "使用少量高品质材质道具，不使用无关奢华符号",
            productRenderingRules: "",
            negativeStyleConstraints: "",
        },
    };
    return presets[styleKey] || presets.clean;
}

function platformLabel(platform: string) {
    return platform === "pinduoduo" ? "拼多多" : platform;
}

export type ProductOutputKind = "basic_image" | "main_image" | "detail_page" | "selling_poster" | "scene_image";

export type ProductDetailSection = {
    title: string;
    objective: string;
    prompt: string;
};

export type ProductAnalysis = {
    productName: string;
    category: string;
    targetAudience: string;
    titleSuggestion: string;
    sellingPoints: string[];
    visualDirection: string;
    complianceNotes: string[];
    detailSections: ProductDetailSection[];
};

export type ProductPlanItem = {
    id: string;
    kind: ProductOutputKind;
    title: string;
    description: string;
    prompt: string;
    aspectRatio: string;
    pageIndex: number;
};

export const productStyleOptions = [
    { value: "clean", label: "清透留白", description: "主体明确，信息克制" },
    { value: "lifestyle", label: "生活场景", description: "自然融入真实使用环境" },
    { value: "value", label: "卖点强化", description: "聚焦转化与核心利益点" },
    { value: "premium", label: "品质质感", description: "强调材质、细节与光影" },
] as const;

export const productOutputDefinitions = [
    { kind: "basic_image", label: "基础商品图", capability: "product.basic", description: "基于原图完成干净、可信的基础商品视觉", requiresAnalysis: false },
    { kind: "main_image", label: "商品主图", capability: "product.main_image", description: "适配拼多多首图浏览与商品识别", requiresAnalysis: false },
    { kind: "selling_poster", label: "卖点海报", capability: "product.analysis", description: "围绕一个真实卖点建立清晰信息层级", requiresAnalysis: true },
    { kind: "scene_image", label: "商品场景图", capability: "product.main_image", description: "将商品自然放入真实使用环境", requiresAnalysis: false },
    { kind: "detail_page", label: "详情页", capability: "product.detail_page", description: "按页规划材质、细节、功能与场景", requiresAnalysis: true },
] as const satisfies ReadonlyArray<{ kind: ProductOutputKind; label: string; capability: string; description: string; requiresAnalysis: boolean }>;

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

export function buildProductVisualPlan(input: { analysis: ProductAnalysis; platform: string; styleKey: string; brandName: string; detailPageLimit: number }) {
    const { analysis } = input;
    const productName = analysis.productName.trim() || "商品";
    const sellingPoints = analysis.sellingPoints.filter(Boolean);
    const primarySellingPoint = sellingPoints[0] || "清晰呈现商品真实特点";
    const style = productStyleOptions.find((item) => item.value === input.styleKey) || productStyleOptions[0];
    const brand = input.brandName.trim() ? `品牌信息：${input.brandName.trim()}。` : "";
    const constraints = `保持商品主体结构、颜色、材质、包装文字与 Logo 一致，不虚构规格、功效、价格或促销信息。${brand}`;
    const context = `商品：${productName}。类目：${analysis.category || "未指定"}。目标人群：${analysis.targetAudience || "大众用户"}。视觉方向：${analysis.visualDirection || style.description}。平台：${platformLabel(input.platform)}。`;
    const items: ProductPlanItem[] = [
        {
            id: "basic-image",
            kind: "basic_image",
            title: "基础商品图",
            description: "建立可信、干净的商品基础视觉",
            prompt: `${context}以${style.label}方式重新整理背景与光线，商品完整清晰，构图克制，保留足够留白。${constraints}`,
            aspectRatio: "1:1",
            pageIndex: 0,
        },
        {
            id: "main-image",
            kind: "main_image",
            title: "拼多多商品主图",
            description: analysis.titleSuggestion || "首屏快速识别商品与核心价值",
            prompt: `${context}生成拼多多方形商品主图，商品占据视觉中心，背景简洁，强化“${primarySellingPoint}”，不添加未经确认的营销文字。${constraints}`,
            aspectRatio: "1:1",
            pageIndex: 0,
        },
        {
            id: "selling-poster",
            kind: "selling_poster",
            title: "核心卖点海报",
            description: primarySellingPoint,
            prompt: `${context}生成纵向卖点海报，以“${primarySellingPoint}”为唯一信息核心，通过商品细节、材质光影和明确留白建立层级；需要文字时仅使用已经确认的商品信息。${constraints}`,
            aspectRatio: "3:4",
            pageIndex: 0,
        },
        {
            id: "scene-image",
            kind: "scene_image",
            title: "真实使用场景",
            description: "呈现商品进入用户生活后的状态",
            prompt: `${context}将商品自然置入符合目标人群的真实使用场景，环境服务于商品，不遮挡主体，不改变商品比例与结构，光线真实克制。${constraints}`,
            aspectRatio: "4:3",
            pageIndex: 0,
        },
    ];

    const fallbacks: ProductDetailSection[] = [
        { title: "商品总览", objective: "建立整体认知", prompt: "纵向详情页首屏，完整展示商品外观与核心使用价值" },
        { title: "材质细节", objective: "呈现真实质感", prompt: "近景表现商品材质、表面纹理、做工与关键细节" },
        { title: "核心卖点", objective: "解释购买理由", prompt: `围绕${primarySellingPoint}建立单一清晰的视觉叙事` },
        { title: "使用方式", objective: "降低理解成本", prompt: "展示商品真实使用方式与必要步骤，画面简洁易懂" },
        { title: "使用场景", objective: "建立生活联想", prompt: "展示商品适合的真实生活场景与空间关系" },
        { title: "尺寸结构", objective: "说明商品构成", prompt: "以克制的信息图式构图呈现商品结构，避免虚构具体尺寸" },
        { title: "包装与配件", objective: "呈现交付内容", prompt: "完整展示图片中可确认的包装与配件，不额外添加物品" },
        { title: "收束画面", objective: "完成详情页节奏", prompt: "以完整商品与安静背景收束整套详情页，保持品牌与视觉方向一致" },
    ];
    const sections = analysis.detailSections.length ? [...analysis.detailSections] : [];
    for (const fallback of fallbacks) if (sections.length < input.detailPageLimit) sections.push(fallback);
    sections.slice(0, input.detailPageLimit).forEach((section, index) => {
        items.push({
            id: `detail-${index + 1}`,
            kind: "detail_page",
            title: section.title || `详情页 ${index + 1}`,
            description: section.objective || "逐页展开商品信息",
            prompt: `${context}${section.prompt}。纵向电商详情页构图，本页只承担“${section.objective || section.title}”这一项信息目标。${constraints}`,
            aspectRatio: "3:4",
            pageIndex: index,
        });
    });
    return items;
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

export function emptyProductAnalysis(productName = ""): ProductAnalysis {
    return {
        productName,
        category: "",
        targetAudience: "",
        titleSuggestion: "",
        sellingPoints: [],
        visualDirection: "",
        complianceNotes: [],
        detailSections: [],
    };
}

function platformLabel(platform: string) {
    return platform === "pinduoduo" ? "拼多多" : platform;
}

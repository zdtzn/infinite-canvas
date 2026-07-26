import { FileText, ImagePlus, Images, Maximize2, Settings2, TrendingUp, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的资产",
        icon: Images,
    },
    {
        slug: "cultivation",
        label: "我的修炼",
        icon: TrendingUp,
    },
    {
        slug: "config",
        label: "配置",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

/** 山海境场景名(纯展示层,路由与功能不变) */
export const navigationSceneNames: Record<NavigationToolSlug, string> = {
    canvas: "洞天",
    image: "丹青台",
    video: "流光阁",
    prompts: "功法楼",
    assets: "藏卷阁",
    cultivation: "命宫",
    config: "洞府",
};

const primaryNavigationSlugs: NavigationToolSlug[] = ["canvas", "image", "assets"];

export const primaryNavigationTools = navigationTools.filter((tool) => primaryNavigationSlugs.includes(tool.slug));
export const secondaryNavigationTools = navigationTools.filter((tool) => !primaryNavigationSlugs.includes(tool.slug));

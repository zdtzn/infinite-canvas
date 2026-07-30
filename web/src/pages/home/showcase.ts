import type { Prompt } from "@/services/api/prompts";

export const HOMEPAGE_PROMPT_SOURCE_ID = "freestylefly-awesome-gpt-image-2";

const EXAMPLE_TITLE_PREFIX = /^例\s*\d+\s*[：:]\s*/;

const curatedTitles = [
    "高端 3D 收藏玩具头像",
    "樱花咖啡户外人像",
    "高端肉类海鲜品牌英雄图",
    "Crumple Chair 概念沙发研发板",
    "抹茶品牌触点系统视觉板",
    "手机爆炸拆解图",
    "水墨双重曝光人物海报",
    "立体刺绣小鸟花枝",
    "《赤壁怀古》长卷图",
    "RAG 技术详解图",
    "月下美女直播画面",
    "零食品牌技术分解图",
] as const;

export function selectHomepagePromptShowcase(items: Prompt[], limit = curatedTitles.length) {
    const available = items.filter((item) => item.coverUrl);
    const byTitle = new Map(available.map((item) => [item.title.replace(EXAMPLE_TITLE_PREFIX, "").trim(), item]));
    const selected = curatedTitles.flatMap((title) => {
        const item = byTitle.get(title);
        return item ? [item] : [];
    });
    const selectedIds = new Set(selected.map((item) => item.id));

    for (const item of available) {
        if (selected.length >= limit) break;
        if (selectedIds.has(item.id)) continue;
        selected.push(item);
        selectedIds.add(item.id);
    }

    return selected.slice(0, limit);
}

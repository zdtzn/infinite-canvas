import type { Prompt } from "@/services/api/prompts";

export const HOMEPAGE_PROMPT_WINDOW_SIZE = 50;
export const HOMEPAGE_PROMPT_ROTATION_MS = 90_000;

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

export function selectHomepagePromptShowcase(items: Prompt[], limit = Number.POSITIVE_INFINITY) {
    const maxItems = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const available = items.filter((item) => {
        if (!item.coverUrl) return false;
        const key = promptIdentity(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const byTitle = new Map(available.map((item) => [item.title.replace(EXAMPLE_TITLE_PREFIX, "").trim(), item]));
    const selected = curatedTitles.flatMap((title) => {
        const item = byTitle.get(title);
        return item ? [item] : [];
    });
    const selectedIds = new Set(selected.map(promptIdentity));

    const remaining = interleaveByCategory(available.filter((item) => !selectedIds.has(promptIdentity(item))));
    for (const item of remaining) {
        if (selected.length >= maxItems) break;
        selected.push(item);
        selectedIds.add(promptIdentity(item));
    }

    return selected.slice(0, maxItems);
}

export function selectHomepagePromptWindow(items: Prompt[], offset: number, size = HOMEPAGE_PROMPT_WINDOW_SIZE) {
    const windowSize = Math.max(1, Math.floor(size));
    if (items.length <= windowSize) return items;
    const start = positiveModulo(Math.floor(offset), items.length);
    return Array.from({ length: windowSize }, (_, index) => items[(start + index) % items.length]);
}

export function promptIdentity(item: Pick<Prompt, "category" | "id">) {
    return `${item.category}\n${item.id}`;
}

function interleaveByCategory(items: Prompt[]) {
    const grouped = new Map<string, Prompt[]>();
    for (const item of items) {
        const group = grouped.get(item.category) || [];
        group.push(item);
        grouped.set(item.category, group);
    }

    const groups = Array.from(grouped.values());
    const interleaved: Prompt[] = [];
    for (let row = 0; interleaved.length < items.length; row += 1) {
        for (const group of groups) {
            if (group[row]) interleaved.push(group[row]);
        }
    }
    return interleaved;
}

function positiveModulo(value: number, modulus: number) {
    return ((value % modulus) + modulus) % modulus;
}

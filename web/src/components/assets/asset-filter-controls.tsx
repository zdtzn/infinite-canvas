import { Button, Select } from "antd";
import type { AssetLibraryFacets } from "@/services/server-api";

export function AssetFilterControls({ facets, category, tags, onChange }: { facets: AssetLibraryFacets; category?: string; tags: string[]; onChange: (category: string | undefined, tags: string[]) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <Select
                aria-label="素材分类"
                className="w-44"
                allowClear
                placeholder="全部分类"
                value={category}
                options={[{ value: "", label: `未分类 (${facets.uncategorized})` }, ...facets.categories.map((value) => ({ value, label: value }))]}
                onChange={(value) => onChange(value, tags)}
            />
            <Select
                aria-label="素材标签"
                className="min-w-44 max-w-full flex-1"
                mode="multiple"
                allowClear
                placeholder="按标签筛选（同时满足）"
                value={tags}
                maxTagCount="responsive"
                options={facets.tags.map((value) => ({ value, label: value }))}
                onChange={(value) => onChange(category, value)}
            />
            {(category !== undefined || tags.length > 0) && (
                <Button type="text" onClick={() => onChange(undefined, [])}>
                    清空筛选
                </Button>
            )}
        </div>
    );
}

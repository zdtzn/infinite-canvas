import { cn } from "@/lib/utils";
import { ALL_PROMPTS_OPTION } from "@/services/api/prompts";

export function PromptFilter({ label, options, selected, onChange }: { label: "来源" | "主题"; options: readonly string[]; selected: string; onChange: (value: string) => void }) {
    return (
        <div role="group" aria-label={label}>
            <div className="mb-2 text-xs font-semibold text-stone-400 dark:text-stone-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={selected === option}
                        className={cn("prompt-filter-tag ant-tag-checkable cursor-pointer focus-visible:outline-2 focus-visible:outline-ring", selected === option && "is-active")}
                        onClick={() => onChange(option)}
                    >
                        {option === ALL_PROMPTS_OPTION ? `全部${label}` : option}
                    </button>
                ))}
            </div>
        </div>
    );
}

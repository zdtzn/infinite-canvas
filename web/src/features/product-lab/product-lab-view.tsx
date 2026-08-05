import { Check, ChevronRight, LockKeyhole, Sparkles } from "lucide-react";

import { cultivationStageLabel } from "@/features/cultivation/utils";
import { cn } from "@/lib/utils";
import type { ProductOutputKind } from "./product-lab";

export function ProductRealmHeader({ realmName, stageName, title, description, imperial }: { realmName: string; stageName: string; title: string; description: string; imperial: boolean }) {
    return (
        <section className={cn("product-realm-header relative overflow-hidden border-b border-stone-200 px-5 py-4 dark:border-white/10 lg:px-8", imperial && "is-imperial")}>
            <div className="relative z-10 mx-auto flex max-w-[1560px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                        <span className="inline-flex h-7 items-center gap-1.5 border border-stone-300 bg-background/70 px-2.5 dark:border-white/12">
                            <Sparkles className="size-3.5" />
                            {cultivationStageLabel(realmName, stageName)}
                        </span>
                        {imperial ? <span className="product-imperial-kicker inline-flex h-7 items-center border border-[#c9a86a]/45 px-2.5 text-[#a68142] dark:text-[#d9bf83]">帝境商品领域</span> : null}
                    </div>
                    <div className="mt-2 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                        <h1 className="shrink-0 text-lg font-semibold text-stone-950 dark:text-[#f4f1e8]">{title}</h1>
                        <p className="min-w-0 truncate text-sm text-stone-500 dark:text-stone-400" title={description}>
                            {description}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

export type ProductWorkflowStep = "source" | "plan" | "generate";

const PRODUCT_WORKFLOW_STEPS: Array<{ key: ProductWorkflowStep; label: string; description: string }> = [
    { key: "source", label: "上传商品", description: "提供真实商品图" },
    { key: "plan", label: "确认方案", description: "选择创作目标" },
    { key: "generate", label: "生成与挑选", description: "生成后手动入藏" },
];

export function ProductWorkflowSteps({ currentStep, availableSteps, onSelect }: { currentStep: ProductWorkflowStep; availableSteps: readonly ProductWorkflowStep[]; onSelect: (step: ProductWorkflowStep) => void }) {
    const currentIndex = PRODUCT_WORKFLOW_STEPS.findIndex((step) => step.key === currentStep);
    return (
        <nav aria-label="商品幻境创作步骤" className="product-workflow-steps grid grid-cols-3 border-b border-stone-200 bg-white/75 dark:border-white/10 dark:bg-white/[0.018]">
            {PRODUCT_WORKFLOW_STEPS.map((step, index) => {
                const available = availableSteps.includes(step.key);
                const completed = index < currentIndex;
                const current = step.key === currentStep;
                return (
                    <button
                        key={step.key}
                        type="button"
                        disabled={!available}
                        aria-current={current ? "step" : undefined}
                        className={cn(
                            "group flex min-w-0 items-center gap-1.5 border-r border-stone-200 px-2 py-3 text-left last:border-r-0 dark:border-white/10 sm:gap-3 sm:px-5",
                            current ? "bg-stone-950 text-white dark:bg-[#c9a86a]/10 dark:text-[#f3e9d3]" : available ? "hover:bg-stone-50 dark:hover:bg-white/[0.035]" : "cursor-not-allowed opacity-45",
                        )}
                        onClick={() => available && onSelect(step.key)}
                    >
                        <span className={cn("grid size-6 shrink-0 place-items-center border text-[11px] font-semibold sm:size-7 sm:text-xs", current ? "border-white/35 dark:border-[#c9a86a]/55" : "border-stone-300 dark:border-white/15")}>
                            {completed ? <Check className="size-3.5" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold sm:text-sm">{step.label}</span>
                            <span className={cn("mt-0.5 hidden truncate text-[11px] sm:block", current ? "text-white/65 dark:text-[#d7c59e]/65" : "text-stone-400")}>{step.description}</span>
                        </span>
                        {index < PRODUCT_WORKFLOW_STEPS.length - 1 ? <ChevronRight className="hidden size-3.5 shrink-0 opacity-30 md:block" /> : null}
                    </button>
                );
            })}
        </nav>
    );
}

export function ProductOutputGrid({
    outputs,
    selectedKinds,
    onToggle,
}: {
    outputs: Array<{
        kind: ProductOutputKind;
        label: string;
        capability: string;
        description: string;
        requiresAnalysis: boolean;
        available: boolean;
        reason: string;
    }>;
    selectedKinds: ProductOutputKind[];
    onToggle: (kind: ProductOutputKind) => void;
}) {
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {outputs.map((output) => {
                const selected = selectedKinds.includes(output.kind);
                return (
                    <button
                        key={output.kind}
                        type="button"
                        disabled={!output.available}
                        className={cn(
                            "min-h-24 border p-3 text-left transition-colors",
                            output.available
                                ? selected
                                    ? "border-stone-950 bg-stone-950 text-white dark:border-[#d1b06c] dark:bg-[#d1b06c]/10 dark:text-[#f4ecd7]"
                                    : "border-stone-200 bg-transparent text-stone-800 hover:border-stone-400 dark:border-white/10 dark:text-stone-200 dark:hover:border-white/25"
                                : "cursor-not-allowed border-stone-200/70 bg-stone-100/50 text-stone-400 dark:border-white/6 dark:bg-white/[0.025] dark:text-stone-500",
                        )}
                        onClick={() => output.available && onToggle(output.kind)}
                    >
                        <span className="flex items-start justify-between gap-3">
                            <span className="text-sm font-semibold">{output.label}</span>
                            {output.available ? (
                                <span className={cn("grid size-5 shrink-0 place-items-center border", selected ? "border-white/35 dark:border-[#d1b06c]/55" : "border-stone-300 dark:border-white/15")}>
                                    {selected ? <Check className="size-3.5" /> : null}
                                </span>
                            ) : (
                                <LockKeyhole className="size-4 shrink-0" />
                            )}
                        </span>
                        <span className="mt-2 block text-xs leading-5 opacity-75">{output.available ? output.description : output.reason}</span>
                    </button>
                );
            })}
        </div>
    );
}

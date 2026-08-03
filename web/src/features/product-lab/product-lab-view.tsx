import { Check, LockKeyhole, Sparkles } from "lucide-react";

import { cultivationStageLabel } from "@/features/cultivation/utils";
import { cn } from "@/lib/utils";
import type { ProductOutputKind } from "./product-lab";

export function ProductRealmHeader({ realmName, stageName, title, description, imperial, capabilities }: { realmName: string; stageName: string; title: string; description: string; imperial: boolean; capabilities: string[] }) {
    const productCapabilityCount = capabilities.filter((capability) => capability.startsWith("product.")).length;
    return (
        <section className={cn("product-realm-header relative overflow-hidden border-b border-stone-200 px-5 py-6 dark:border-white/10 lg:px-8", imperial && "is-imperial")}>
            <div className="relative z-10 mx-auto flex max-w-[1560px] flex-col justify-between gap-5 lg:flex-row lg:items-end">
                <div className="min-w-0 max-w-3xl">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                        <span className="inline-flex h-7 items-center gap-1.5 border border-stone-300 bg-background/70 px-2.5 dark:border-white/12">
                            <Sparkles className="size-3.5" />
                            {cultivationStageLabel(realmName, stageName)}
                        </span>
                        {imperial ? <span className="product-imperial-kicker inline-flex h-7 items-center border border-[#c9a86a]/45 px-2.5 text-[#a68142] dark:text-[#d9bf83]">帝境商品领域</span> : null}
                    </div>
                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-[#f4f1e8]">{title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">{description}</p>
                </div>
                <div className="flex shrink-0 items-end gap-7 border-l border-stone-200 pl-5 dark:border-white/10">
                    <div>
                        <div className="text-[11px] text-stone-500 dark:text-stone-500">当前已掌握</div>
                        <div className="mt-1 text-xl font-semibold text-stone-900 dark:text-stone-100">{productCapabilityCount}</div>
                    </div>
                    <div className="max-w-44 text-xs leading-5 text-stone-500 dark:text-stone-400">商品能力来自当前境界与系统开放状态</div>
                </div>
            </div>
        </section>
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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

import { cn } from "@/lib/utils";

export function ImperialSeal({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
    return <img src="/imperial/imperial-seal-v1.webp" alt={decorative ? "" : "斗帝帝印"} aria-hidden={decorative || undefined} width={320} height={320} decoding="async" className={cn("shrink-0 object-contain", className)} />;
}

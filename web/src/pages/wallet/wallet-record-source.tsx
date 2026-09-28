import { ChevronDown } from "lucide-react";

import type { WalletLedgerItem, WalletPackage } from "@/services/server-api";
import { walletRecordSource } from "./wallet-ui";

export function WalletRecordSource({ item, packages }: { item: WalletLedgerItem; packages: WalletPackage[] }) {
    const source = walletRecordSource(item, packages);
    if (!source.fullId) return <span>{source.label}</span>;
    return (
        <details className="wallet-source-disclosure">
            <summary>
                <span>{source.label}</span>
                <ChevronDown size={14} aria-hidden="true" />
                <span className="sr-only">，查看完整任务编号</span>
            </summary>
            <div className="wallet-source-full">
                <span>完整任务编号</span>
                <code>{source.fullId}</code>
            </div>
        </details>
    );
}

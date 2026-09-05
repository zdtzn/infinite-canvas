import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { ImperialModeProvider, useImperialMode } from "./imperial-mode";
import { cultivationProfileQueryKeyFor } from "./queries";

function SuccessProbe() {
    const { generationSuccessMessage } = useImperialMode();
    return <>{generationSuccessMessage("图片已生成")}</>;
}

function renderFeedback(realmId: string | null) {
    const client = new QueryClient();
    // Seed both runtime modes; this rendering test never performs a profile request.
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), realmId ? { realmId } : null);
    try {
        return renderToStaticMarkup(
            <QueryClientProvider client={client}>
                <ImperialModeProvider>
                    <SuccessProbe />
                </ImperialModeProvider>
            </QueryClientProvider>,
        );
    } finally {
        client.clear();
    }
}

test("ordinary realm success text remains unchanged and contains no emperor image", () => {
    expect(renderFeedback("realm-dou-qi")).toBe("图片已生成");
    expect(renderFeedback("realm-dou-saint")).toBe("图片已生成");
});

test("an unresolved profile does not render exclusive success assets", () => {
    expect(renderFeedback(null)).toBe("图片已生成");
});

test("emperor success decorates only the notification and retains the original result message", () => {
    const html = renderFeedback("realm-dou-emperor");
    expect(html).toContain("图片已生成");
    expect(html).toContain("一念落笔，万象成卷。");
    expect(html).toContain("/imperial/imperial-seal-v1.webp");
    expect(html).toContain("imperial-success-seal");
    expect(html).not.toContain("realm-scene");
});

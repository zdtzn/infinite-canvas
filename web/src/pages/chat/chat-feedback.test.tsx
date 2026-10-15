import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "@/services/chat-api";
import { ChatBubble } from "./index";

test("a failed empty response shows one notice and keeps provider errors in closed details", () => {
    const item: ChatMessage = { id: "fixture", conversationId: "conversation", role: "assistant", content: "", attachments: [], status: "failed", error: "Provider failed（请求编号 fixture12345）", createdAt: 1, updatedAt: 1 };
    const html = renderToStaticMarkup(<ChatBubble item={item} isLatest onAction={() => {}} />);
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/^<details\b[^>]*\bopen(?:\s|=|>)/);
    const primary = html.replace(details!, "");
    expect((primary.match(/这次回答暂未完成/g) || []).length).toBe(1);
    expect(primary).not.toMatch(/Provider failed|fixture12345|请求编号/);
    expect((html.match(/fixture12345/g) || []).length).toBe(1);
});

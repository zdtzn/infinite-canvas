import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";

import { announcementStyleVariables } from "../../lib/announcement-style";

import type { SystemAnnouncement } from "@/services/server-api";

function realFunction(path: string, name: string, bindings: Record<string, unknown>) {
    const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const compiled = ts.transpileModule(declaration.getText(file).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    return new Function(...Object.keys(bindings), `${compiled}\nreturn ${name};`)(...Object.values(bindings));
}

const announcement = { id: "notice", title: "更新通知", summary: "", content: "第一段\n第二段", updatedAt: 1, publishedAt: 1 } as SystemAnnouncement;
const settle = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };

// Exercise the real component and callbacks with isolated hook state, without
// globally mocking React, the account store or the API for other Bun tests.
function session() {
    const slots: any[] = [];
    const effects: Array<() => void> = [];
    const reads: Array<[string, string]> = [];
    let userId = "alice";
    let item = announcement;
    let cursor = 0;
    let stateWrites = 0;
    let invalidations = 0;
    let resolveRead!: () => void;
    let rejectRead!: (reason: Error) => void;
    const ack = new Promise<void>((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
    const Component = realFunction("./announcement-auto-prompt.tsx", "AnnouncementPromptSession", {
        announcementStyleVariables, React, Modal: "announcement-modal", theme: { useToken: () => ({ token: {} }) },
        useQueryClient: () => ({ invalidateQueries: async () => { invalidations++; } }),
        useUnreadAnnouncements: () => ({ data: { items: [item] } }),
        useUserStore: { getState: () => ({ user: { id: userId } }) },
        markAnnouncementRead: (id: string, owner: string) => { reads.push([id, owner]); return ack; },
        useState: (initial: any) => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
            return [slots[index], (next: any) => { stateWrites++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
        },
        useRef: (initial: unknown) => {
            const index = cursor++;
            return slots[index] ??= { current: initial };
        },
        useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
            const index = cursor++;
            if (!slots[index] || deps.some((value, offset) => value !== slots[index].deps[offset])) {
                effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
            }
        },
    });
    return {
        reads, resolveRead, rejectRead,
        render() {
            cursor = 0;
            const view = Component({ userId: "alice" }) as React.ReactElement<any>;
            effects.splice(0).forEach((effect) => effect());
            return view.props;
        },
        unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
        changeUser(value: string) { userId = value; },
        changeItem(value: SystemAnnouncement) { item = value; },
        get stateWrites() { return stateWrites; },
        get invalidations() { return invalidations; },
    };
}

test("acknowledgement failure leaves the announcement open and retryable", async () => {
    const view = session();
    view.render().onOk();
    view.rejectRead(new Error("当前渠道或模型暂时不可用"));
    await settle();
    const modal = view.render();
    expect(modal.open).toBe(true);
    expect(modal.confirmLoading).toBe(false);
    expect(JSON.stringify(modal.children)).toContain("请再次点击");
    expect(JSON.stringify(modal.children)).toContain("阅读记录暂时未能保存");
    expect(JSON.stringify(modal.children)).not.toMatch(/渠道|模型/);
    expect(view.invalidations).toBe(0);
});

test("successful acknowledgement hides a stale unread cache only after the server responds", async () => {
    const view = session();
    view.render().onOk();
    view.render().onOk();
    expect(view.reads).toEqual([["notice", "alice"]]);
    expect(view.render().open).toBe(true);
    expect(view.render().confirmLoading).toBe(true);
    view.resolveRead();
    await settle();
    expect(view.render().open).toBe(false);
    expect(view.invalidations).toBe(1);
    view.changeItem({ ...announcement, id: "next" });
    expect(view.render().open).toBe(true);
});

test("deferring never writes a receipt and a new revision can prompt again", () => {
    const view = session();
    view.render().onCancel();
    expect(view.render().open).toBe(false);
    expect(view.render().open).toBe(false);
    expect(view.reads).toEqual([]);
    view.changeItem({ ...announcement, updatedAt: 2 });
    expect(view.render().open).toBe(false);
    view.changeItem({ ...announcement, updatedAt: 3, publishedAt: 3 });
    expect(view.render().open).toBe(true);
    expect(session().render().open).toBe(true);
});

test("late acknowledgements after account change or unmount cannot alter the new session", async () => {
    for (const leave of ["switch", "unmount"]) {
        const view = session();
        view.render().onOk();
        if (leave === "switch") view.changeUser("bob");
        else view.unmount();
        const writesBeforeResponse = view.stateWrites;
        view.resolveRead();
        await settle();
        expect(view.stateWrites).toBe(writesBeforeResponse);
        expect(view.invalidations).toBe(0);
    }
});

test("the bell shares the account query while only the global prompt owns polling", async () => {
    const calls: any[] = [];
    const hook = realFunction("../../hooks/use-unread-announcements.ts", "useUnreadAnnouncements", {
        PUBLIC_MODE: true,
        useUserStore: (select: (state: unknown) => unknown) => select({ user: { id: "alice" } }),
        useQuery: (options: unknown) => options,
        fetchAnnouncements: (...args: unknown[]) => { calls.push(args); },
    });
    const auto = hook("alice");
    const bell = hook(undefined, false);
    expect(auto.queryKey).toEqual(bell.queryKey);
    expect(auto.refetchInterval).toBe(60_000);
    expect(bell.refetchInterval).toBe(false);
    expect(auto.staleTime).toBe(30_000);
    expect(auto.refetchOnWindowFocus).toBe(true);
    expect(hook("bob").enabled).toBe(false);
    await auto.queryFn();
    expect(calls).toEqual([[{ page: 1, pageSize: 1, unreadOnly: true, sort: "newest" }, "alice"]]);
});

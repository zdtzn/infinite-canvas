import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DouQiLifeState, DouQiLifeSession } from "@/services/dou-qi-life-api";
import { ActionDock } from "./dou-qi-life-view";
import { LifeGoals, LifeRecap } from "./dou-qi-life-panels";

const state = { player: { name: "沈砚", age: 18, lifespan: 100, realm: "斗之气", qiStage: 1, qi: 0, qiMax: 100, life: 100, lifeMax: 100, lifeGoal: "寻父" }, world: { location: "青山镇" }, inventory: { items: [] }, techniques: [{ id: "t", name: "八极崩", kind: "斗技", grade: "黄阶" }], battle: { active: true }, npcs: [], memory: { worldEvents: [{ id: "visible", known: true, status: "investigating", title: "山中异动", description: "寻找足迹", location: "后山" }, { id: "hidden", known: false, status: "open", title: "秘密事件" }], choices: ["选择留在青山镇"], recentEvents: ["发现一封家书"], longTermFacts: [], unresolvedGoals: ["追查家书来源"] } } as unknown as DouQiLifeState;

test("action dock exposes stop and elapsed time, leaves next draft editable", () => {
    const html = renderToStaticMarkup(<ActionDock state={state} ended={false} suggestions={[]} sending elapsed={15} draft="下一步" onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />);
    expect(html).toContain("停止推演");
    expect(html).toContain("15 秒");
    expect(html).toContain("当前斗气不足");
    expect(html).toContain("消耗 12 斗气");
    expect(html.match(/<textarea[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html).not.toContain("修炼一日");
});

test("goals show unresolved clues and real statuses without hidden world events", () => {
    const html = renderToStaticMarkup(<LifeGoals state={state} />);
    expect(html).toContain("山中异动"); expect(html).toContain("调查中"); expect(html).toContain("追查家书来源"); expect(html).toContain("家书"); expect(html).not.toContain("秘密事件");
});

test("recap displays choices and source branch without inventing story", () => {
    const session = { state: { ...state, memory: { ...state.memory, branchOrigin: { sessionId: "original", saveId: "saved", title: "入山之前", createdAt: 1 } } } } as DouQiLifeSession;
    const html = renderToStaticMarkup(<LifeRecap session={session} />);
    expect(html).toContain("入山之前"); expect(html).toContain("选择留在青山镇"); expect(html).toContain("命途刚刚展开");
});
